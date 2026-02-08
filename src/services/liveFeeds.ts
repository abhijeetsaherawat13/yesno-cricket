import { buildMarkets } from '../data/mockData'
import type { GameMarket, Match } from '../types/app'

const CRICKETDATA_API_KEY = (import.meta.env.VITE_CRICKETDATA_API_KEY as string | undefined)?.trim()
const ODDS_API_KEY = (import.meta.env.VITE_ODDS_API_KEY as string | undefined)?.trim()
const ODDS_REGIONS = (import.meta.env.VITE_ODDS_REGIONS as string | undefined)?.trim() || 'uk'
const ODDS_CRICKET_SPORTS = ((import.meta.env.VITE_ODDS_CRICKET_SPORTS as string | undefined) ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const ODDS_MAX_SPORTS = Math.max(1, Number(import.meta.env.VITE_ODDS_MAX_SPORTS ?? 4))

const MATCH_CACHE_MS = 45_000
const ODDS_CACHE_MS = 45_000
const SPORTS_CACHE_MS = 6 * 60 * 60 * 1000

interface OddsPair {
  teamA: string
  teamB: string
  priceA: number
  priceB: number
}

interface ScoreState {
  runs: number
  wickets: number
  overs: number | null
  hasScore: boolean
}

interface CacheEntry<T> {
  at: number
  data: T
}

let matchesCache: CacheEntry<Match[]> | null = null
let oddsCache: CacheEntry<OddsPair[]> | null = null
let sportsCache: CacheEntry<string[]> | null = null

const FLAG_BY_CODE: Record<string, string> = {
  IND: '🇮🇳',
  AUS: '🇦🇺',
  ENG: '🏴',
  NZ: '🇳🇿',
  SA: '🇿🇦',
  WI: '🌴',
  PAK: '🇵🇰',
  BAN: '🇧🇩',
  AFG: '🇦🇫',
  SL: '🇱🇰',
  MI: '🔵',
  CSK: '🟡',
  RCB: '🔴',
  DC: '🔵',
  KKR: '💜',
  SRH: '🧡',
}

const STOP_WORDS = new Set([
  'women',
  'woman',
  'men',
  'man',
  'xi',
  'a',
  'team',
  'club',
  'cricket',
  'the',
  'of',
])

export const areLiveFeedsEnabled = Boolean(CRICKETDATA_API_KEY)

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function clampPrice(value: number): number {
  return Math.min(99, Math.max(1, Math.round(value)))
}

function clampProbability(value: number): number {
  return Math.min(0.99, Math.max(0.01, value))
}

function hashToInt(input: string): number {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash) + 1
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(name: string): string[] {
  return normalizeTeamName(name)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenize(left)
  const rightTokens = tokenize(right)

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0
  }

  const rightSet = new Set(rightTokens)
  const hits = leftTokens.filter((token) => rightSet.has(token)).length
  return hits / Math.max(leftTokens.length, rightTokens.length)
}

function resolveFlag(shortCode: string): string {
  return FLAG_BY_CODE[shortCode.toUpperCase()] ?? '🏏'
}

function shortCode(name: string): string {
  const words = normalizeTeamName(name)
    .split(' ')
    .filter(Boolean)

  if (words.length === 0) {
    return 'TEAM'
  }

  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }

  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

function parseTeamsFromName(name: string): [string, string] | null {
  const head = name.split(',')[0]?.trim() ?? ''
  if (!head) {
    return null
  }

  const parts = head.split(/\s+vs\s+|\s+v\s+/i)
  if (parts.length < 2) {
    return null
  }

  return [parts[0].trim(), parts[1].trim()]
}

function formatScore(scoreRow?: Record<string, unknown>): { score: string; overs: string } {
  if (!scoreRow) {
    return { score: '0-0', overs: '' }
  }

  const runs = asNumber(scoreRow.r, 0)
  const wickets = asNumber(scoreRow.w, 0)
  const overs = asNumber(scoreRow.o, Number.NaN)

  return {
    score: `${Math.round(runs)}/${Math.round(wickets)}`,
    overs: Number.isFinite(overs) ? String(overs) : '',
  }
}

function inferCategory(matchName: string, matchType: string): string {
  const name = matchName.toLowerCase()
  const type = matchType.toLowerCase()

  if (name.includes('ipl')) {
    return 'IPL'
  }
  if (type.includes('t20') || name.includes('t20')) {
    return 'T20 Leagues'
  }
  if (type.includes('odi') || type.includes('test') || type.includes('international')) {
    return 'International'
  }

  return 'Cricket'
}

function inferIsLive(statusText: string): boolean {
  const status = statusText.toLowerCase()
  return status.includes('live') || status.includes('innings') || status.includes('in progress') || status.includes('running')
}

function formatTimeLabel(statusText: string, dateTimeGmt: string, fallbackDate: string): string {
  if (inferIsLive(statusText)) {
    return 'Now'
  }

  const parsedDate = Date.parse(dateTimeGmt)
  if (Number.isFinite(parsedDate)) {
    return new Date(parsedDate).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return fallbackDate || 'Upcoming'
}

function syntheticVolume(seed: string): string {
  const base = (hashToInt(seed) % 70) + 30
  return `${(base / 10).toFixed(1)}L`
}

function parseTeamLabel(raw: string): { full: string; short: string } {
  const value = raw.trim()
  if (!value) {
    return { full: 'Team', short: 'TEAM' }
  }

  const withCode = value.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  if (!withCode) {
    return {
      full: value,
      short: shortCode(value),
    }
  }

  const full = withCode[1].trim() || value
  const short = withCode[2].trim().toUpperCase() || shortCode(full)
  return { full, short }
}

function parseCricketOvers(rawOvers: unknown): number | null {
  const value = String(rawOvers ?? '').trim()
  if (!value) {
    return null
  }

  const match = value.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) {
    return null
  }

  const wholeOvers = Number.parseInt(match[1], 10)
  if (!Number.isFinite(wholeOvers)) {
    return null
  }

  const ballDigit = match[2] ? Number.parseInt(match[2][0] ?? '0', 10) : 0
  if (!Number.isFinite(ballDigit)) {
    return wholeOvers
  }

  const legalBalls = Math.max(0, Math.min(5, ballDigit))
  return wholeOvers + legalBalls / 6
}

function parseScoreState(scoreRow?: Record<string, unknown>): ScoreState {
  if (!scoreRow) {
    return {
      runs: 0,
      wickets: 0,
      overs: null,
      hasScore: false,
    }
  }

  const runs = asNumber(scoreRow.r, 0)
  const wickets = asNumber(scoreRow.w, 0)
  const overs = parseCricketOvers(scoreRow.o)
  const hasScore = Object.hasOwn(scoreRow, 'r') || Object.hasOwn(scoreRow, 'w') || Object.hasOwn(scoreRow, 'o')

  return {
    runs: Math.max(0, runs),
    wickets: Math.max(0, wickets),
    overs,
    hasScore,
  }
}

function parseCompactScore(rawScore: string): { score: string; overs: string; state: ScoreState } {
  const value = rawScore.trim()
  if (!value) {
    return {
      score: 'Yet to bat',
      overs: '',
      state: {
        runs: 0,
        wickets: 0,
        overs: null,
        hasScore: false,
      },
    }
  }

  const parsed = value.match(/(\d+)\s*\/\s*(\d+)(?:\s*\(([\d.]+)\))?/)
  if (!parsed) {
    return {
      score: value,
      overs: '',
      state: {
        runs: 0,
        wickets: 0,
        overs: null,
        hasScore: false,
      },
    }
  }

  const runs = Number.parseInt(parsed[1], 10)
  const wickets = Number.parseInt(parsed[2], 10)
  const overs = (parsed[3] ?? '').trim()
  const safeRuns = Number.isFinite(runs) ? runs : 0
  const safeWickets = Number.isFinite(wickets) ? wickets : 0

  return {
    score: `${Math.max(0, safeRuns)}/${Math.max(0, safeWickets)}`,
    overs,
    state: {
      runs: Math.max(0, safeRuns),
      wickets: Math.max(0, safeWickets),
      overs: parseCricketOvers(overs),
      hasScore: true,
    },
  }
}

function inferLimitedOvers(matchName: string, matchType: string): number | null {
  const text = `${matchName} ${matchType}`.toLowerCase()

  if (text.includes('t10')) {
    return 10
  }

  if (text.includes('t20') || text.includes('ipl')) {
    return 20
  }

  if (text.includes('odi') || text.includes('one day')) {
    return 50
  }

  return null
}

function inferParScore(totalOvers: number): number {
  if (totalOvers <= 10) {
    return 95
  }

  if (totalOvers <= 20) {
    return 165
  }

  if (totalOvers <= 50) {
    return 285
  }

  return 250
}

function detectWinnerFromStatus(statusText: string, teamAFull: string, teamBFull: string): 'A' | 'B' | null {
  const normalizedStatus = normalizeTeamName(statusText)
  if (!normalizedStatus.includes('won')) {
    return null
  }

  const aHit = tokenOverlap(teamAFull, statusText)
  const bHit = tokenOverlap(teamBFull, statusText)

  if (aHit > bHit && aHit >= 0.3) {
    return 'A'
  }

  if (bHit > aHit && bHit >= 0.3) {
    return 'B'
  }

  return null
}

function inferLiveFromMode(
  mode: string,
  statusText: string,
  scoreA: ScoreState,
  scoreB: ScoreState,
): boolean {
  const normalizedMode = mode.trim().toLowerCase()
  const normalizedStatus = statusText.trim().toLowerCase()

  if (normalizedMode === 'result' || normalizedStatus.includes('won')) {
    return false
  }

  if (normalizedMode === 'fixture') {
    return false
  }

  if (normalizedStatus.includes('starts at') || normalizedStatus.includes('not started')) {
    return false
  }

  if (normalizedMode === 'live') {
    return true
  }

  if (inferIsLive(statusText)) {
    return true
  }

  return scoreA.hasScore || scoreB.hasScore
}

function computeModeledPriceA(params: {
  rawId: string
  matchName: string
  matchType: string
  statusText: string
  isLive: boolean
  teamAFull: string
  teamBFull: string
  scoreA: ScoreState
  scoreB: ScoreState
}): number {
  const {
    rawId,
    matchName,
    matchType,
    statusText,
    isLive,
    teamAFull,
    teamBFull,
    scoreA,
    scoreB,
  } = params

  const winner = detectWinnerFromStatus(statusText, teamAFull, teamBFull)
  if (winner === 'A') {
    return 99
  }

  if (winner === 'B') {
    return 1
  }

  let probabilityA = 0.5

  const seedBias = ((hashToInt(rawId) % 9) - 4) * 0.006
  probabilityA += seedBias

  const totalOvers = inferLimitedOvers(matchName, matchType)
  const hasA = scoreA.hasScore
  const hasB = scoreB.hasScore

  if (hasA || hasB) {
    const runDiff = scoreA.runs - scoreB.runs
    probabilityA += Math.tanh(runDiff / 45) * 0.2

    const wicketEdge = scoreB.wickets - scoreA.wickets
    probabilityA += Math.tanh(wicketEdge / 3) * 0.1
  }

  if (isLive && totalOvers && hasB && (scoreB.overs ?? 0) > 0.2) {
    const chaseOvers = Math.max(0.1, scoreB.overs ?? 0)
    const target = scoreA.runs + 1
    const runsNeeded = Math.max(0, target - scoreB.runs)
    const remainingOvers = Math.max(0, totalOvers - chaseOvers)

    if (remainingOvers <= 0.1) {
      probabilityA += runsNeeded > 0 ? 0.35 : -0.35
    } else {
      const requiredRate = runsNeeded / remainingOvers
      const currentRate = scoreB.runs / chaseOvers
      const rateEdge = requiredRate - currentRate
      probabilityA += Math.tanh(rateEdge / 2.4) * 0.28
    }

    probabilityA += Math.tanh((scoreB.wickets - 4) / 2.4) * 0.14
  } else if (isLive && totalOvers && hasA && (scoreA.overs ?? 0) > 0.5) {
    const battingOvers = Math.max(0.1, scoreA.overs ?? 0)
    const projected = (scoreA.runs / battingOvers) * totalOvers
    const par = inferParScore(totalOvers)
    probabilityA += Math.tanh((projected - par) / 40) * 0.16
    probabilityA += Math.tanh((4 - scoreA.wickets) / 2.8) * 0.09
  }

  return clampPrice(clampProbability(probabilityA) * 100)
}

function findOddsForTeams(teamA: string, teamB: string, pairs: OddsPair[]): { priceA: number; priceB: number } | null {
  const normalizedA = normalizeTeamName(teamA)
  const normalizedB = normalizeTeamName(teamB)

  for (const pair of pairs) {
    const pairA = normalizeTeamName(pair.teamA)
    const pairB = normalizeTeamName(pair.teamB)

    if (pairA === normalizedA && pairB === normalizedB) {
      return { priceA: pair.priceA, priceB: pair.priceB }
    }

    if (pairA === normalizedB && pairB === normalizedA) {
      return { priceA: pair.priceB, priceB: pair.priceA }
    }
  }

  let bestScore = 0
  let bestMatch: { priceA: number; priceB: number } | null = null

  for (const pair of pairs) {
    const directScore = tokenOverlap(teamA, pair.teamA) + tokenOverlap(teamB, pair.teamB)
    if (directScore > bestScore) {
      bestScore = directScore
      bestMatch = { priceA: pair.priceA, priceB: pair.priceB }
    }

    const swappedScore = tokenOverlap(teamA, pair.teamB) + tokenOverlap(teamB, pair.teamA)
    if (swappedScore > bestScore) {
      bestScore = swappedScore
      bestMatch = { priceA: pair.priceB, priceB: pair.priceA }
    }
  }

  return bestScore >= 1.1 ? bestMatch : null
}

async function fetchCricketSportKeys(): Promise<string[]> {
  if (!ODDS_API_KEY) {
    return []
  }

  if (ODDS_CRICKET_SPORTS.length > 0) {
    return ODDS_CRICKET_SPORTS.slice(0, ODDS_MAX_SPORTS)
  }

  if (sportsCache && Date.now() - sportsCache.at < SPORTS_CACHE_MS) {
    return sportsCache.data
  }

  const url = new URL('https://api.the-odds-api.com/v4/sports/')
  url.searchParams.set('apiKey', ODDS_API_KEY)

  const response = await fetch(url.toString())
  if (!response.ok) {
    return []
  }

  const payload = asArray((await response.json()) as unknown)
  const sportKeys = payload
    .map((entry) => asString(asRecord(entry).key))
    .filter((key) => key.startsWith('cricket_'))
    .slice(0, ODDS_MAX_SPORTS)

  sportsCache = { at: Date.now(), data: sportKeys }
  return sportKeys
}

function parseOddsPair(entry: Record<string, unknown>): OddsPair | null {
  const homeTeam = asString(entry.home_team)
  const awayTeam = asString(entry.away_team)

  if (!homeTeam || !awayTeam) {
    return null
  }

  const bookmakers = asArray(entry.bookmakers).map(asRecord)
  let outcomes: Record<string, unknown>[] = []

  for (const bookmaker of bookmakers) {
    const markets = asArray(bookmaker.markets).map(asRecord)
    const h2hMarket = markets.find((market) => asString(market.key) === 'h2h') ?? markets[0]
    if (!h2hMarket) {
      continue
    }

    const candidateOutcomes = asArray(h2hMarket.outcomes).map(asRecord)
    if (candidateOutcomes.length >= 2) {
      outcomes = candidateOutcomes
      break
    }
  }

  if (outcomes.length < 2) {
    return null
  }

  const normalizedHome = normalizeTeamName(homeTeam)
  const normalizedAway = normalizeTeamName(awayTeam)

  let homeOutcome = outcomes.find((outcome) => normalizeTeamName(asString(outcome.name)) === normalizedHome)
  let awayOutcome = outcomes.find((outcome) => normalizeTeamName(asString(outcome.name)) === normalizedAway)

  if (!homeOutcome || !awayOutcome) {
    const nonDraw = outcomes.filter((outcome) => normalizeTeamName(asString(outcome.name)) !== 'draw')
    if (nonDraw.length >= 2) {
      homeOutcome = nonDraw[0]
      awayOutcome = nonDraw[1]
    }
  }

  if (!homeOutcome || !awayOutcome) {
    return null
  }

  const homePrice = asNumber(homeOutcome.price, 0)
  const awayPrice = asNumber(awayOutcome.price, 0)

  if (homePrice <= 1 || awayPrice <= 1) {
    return null
  }

  const homeProbability = 1 / homePrice
  const awayProbability = 1 / awayPrice
  const total = homeProbability + awayProbability

  if (!Number.isFinite(total) || total <= 0) {
    return null
  }

  const normalizedHomePrice = clampPrice((homeProbability / total) * 100)
  const normalizedAwayPrice = clampPrice(100 - normalizedHomePrice)

  return {
    teamA: homeTeam,
    teamB: awayTeam,
    priceA: normalizedHomePrice,
    priceB: normalizedAwayPrice,
  }
}

async function fetchOddsPairs(): Promise<OddsPair[]> {
  if (!ODDS_API_KEY) {
    return []
  }

  if (oddsCache && Date.now() - oddsCache.at < ODDS_CACHE_MS) {
    return oddsCache.data
  }

  const sportKeys = await fetchCricketSportKeys()
  if (sportKeys.length === 0) {
    return []
  }

  const pairs: OddsPair[] = []

  await Promise.all(
    sportKeys.map(async (sportKey) => {
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`)
      url.searchParams.set('apiKey', ODDS_API_KEY)
      url.searchParams.set('regions', ODDS_REGIONS)
      url.searchParams.set('markets', 'h2h')
      url.searchParams.set('oddsFormat', 'decimal')
      url.searchParams.set('dateFormat', 'iso')

      const response = await fetch(url.toString())
      if (!response.ok) {
        return
      }

      const payload = asArray((await response.json()) as unknown)
      for (const event of payload) {
        const parsed = parseOddsPair(asRecord(event))
        if (parsed) {
          pairs.push(parsed)
        }
      }
    }),
  )

  oddsCache = { at: Date.now(), data: pairs }
  return pairs
}

function mapCricapiMatch(entry: Record<string, unknown>, oddsPairs: OddsPair[]): Match | null {
  const rawId = asString(entry.id, asString(entry.unique_id, asString(entry.name, '')))
  if (!rawId) {
    return null
  }

  const name = asString(entry.name, 'Cricket Match')
  const matchType = asString(entry.matchType)
  const statusText = asString(entry.status)
  const dateLabel = asString(entry.date)
  const dateTimeGmt = asString(entry.dateTimeGMT)

  const teamInfo = asArray(entry.teamInfo).map(asRecord)
  const listedTeams = asArray(entry.teams).map((team) => asString(team)).filter(Boolean)
  const parsedTeams = parseTeamsFromName(name)

  const teamAFull =
    asString(asRecord(teamInfo[0]).name) ||
    listedTeams[0] ||
    parsedTeams?.[0] ||
    'Team A'
  const teamBFull =
    asString(asRecord(teamInfo[1]).name) ||
    listedTeams[1] ||
    parsedTeams?.[1] ||
    'Team B'

  const teamA = asString(asRecord(teamInfo[0]).shortname) || shortCode(teamAFull)
  const teamB = asString(asRecord(teamInfo[1]).shortname) || shortCode(teamBFull)

  const scoreRows = asArray(entry.score).map(asRecord)
  const scoreAEntry =
    scoreRows.find((row) => normalizeTeamName(asString(row.inning)).includes(normalizeTeamName(teamAFull))) ??
    scoreRows[0]
  const scoreBEntry =
    scoreRows.find((row) => normalizeTeamName(asString(row.inning)).includes(normalizeTeamName(teamBFull))) ??
    scoreRows[1]

  const scoreA = formatScore(scoreAEntry)
  const scoreB = formatScore(scoreBEntry)
  const scoreAState = parseScoreState(scoreAEntry)
  const scoreBState = parseScoreState(scoreBEntry)
  const isLive = inferIsLive(statusText)

  const odds = findOddsForTeams(teamAFull, teamBFull, oddsPairs)
  const modeledPriceA = computeModeledPriceA({
    rawId,
    matchName: name,
    matchType,
    statusText,
    isLive,
    teamAFull,
    teamBFull,
    scoreA: scoreAState,
    scoreB: scoreBState,
  })
  const priceA = clampPrice(odds?.priceA ?? modeledPriceA)
  const priceB = clampPrice(odds?.priceB ?? 100 - priceA)

  return {
    id: hashToInt(rawId),
    teamA,
    teamB,
    teamAFull,
    teamBFull,
    flagA: resolveFlag(teamA),
    flagB: resolveFlag(teamB),
    scoreA: scoreA.score,
    scoreB: scoreBEntry ? scoreB.score : 'Yet to bat',
    oversA: scoreA.overs,
    oversB: scoreB.overs,
    priceA,
    priceB,
    volume: syntheticVolume(rawId),
    time: formatTimeLabel(statusText, dateTimeGmt, dateLabel),
    isLive,
    category: inferCategory(name, matchType),
    marketsCount: 16,
  }
}

function mapCricScoreMatch(entry: Record<string, unknown>, oddsPairs: OddsPair[]): Match | null {
  const rawId = asString(entry.id)
  if (!rawId) {
    return null
  }

  const matchMode = asString(entry.ms).toLowerCase()
  if (matchMode === 'result') {
    return null
  }

  const teamARaw = asString(entry.t1)
  const teamBRaw = asString(entry.t2)
  if (!teamARaw || !teamBRaw) {
    return null
  }

  const teamAInfo = parseTeamLabel(teamARaw)
  const teamBInfo = parseTeamLabel(teamBRaw)
  if (normalizeTeamName(teamAInfo.full) === 'tbc' || normalizeTeamName(teamBInfo.full) === 'tbc') {
    return null
  }

  const matchType = asString(entry.matchType)
  const statusText = asString(entry.status)
  const dateTimeGmt = asString(entry.dateTimeGMT)
  const series = asString(entry.series, 'Cricket Match')
  const dateLabel = asString(entry.date)

  const scoreA = parseCompactScore(asString(entry.t1s))
  const scoreB = parseCompactScore(asString(entry.t2s))
  const isLive = inferLiveFromMode(matchMode, statusText, scoreA.state, scoreB.state)

  const odds = findOddsForTeams(teamAInfo.full, teamBInfo.full, oddsPairs)
  const modeledPriceA = computeModeledPriceA({
    rawId,
    matchName: series,
    matchType,
    statusText,
    isLive,
    teamAFull: teamAInfo.full,
    teamBFull: teamBInfo.full,
    scoreA: scoreA.state,
    scoreB: scoreB.state,
  })
  const priceA = clampPrice(odds?.priceA ?? modeledPriceA)
  const priceB = clampPrice(odds?.priceB ?? 100 - priceA)

  const timeLabel = isLive ? 'Now' : formatTimeLabel(statusText, dateTimeGmt, dateLabel || statusText)

  return {
    id: hashToInt(rawId),
    teamA: teamAInfo.short,
    teamB: teamBInfo.short,
    teamAFull: teamAInfo.full,
    teamBFull: teamBInfo.full,
    flagA: resolveFlag(teamAInfo.short),
    flagB: resolveFlag(teamBInfo.short),
    scoreA: scoreA.score,
    scoreB: scoreB.score,
    oversA: scoreA.overs,
    oversB: scoreB.overs,
    priceA,
    priceB,
    volume: syntheticVolume(rawId),
    time: timeLabel,
    isLive,
    category: inferCategory(series, matchType),
    marketsCount: 16,
  }
}

async function fetchCricapiRows(endpoint: string): Promise<unknown[] | null> {
  const url = new URL(`https://api.cricapi.com/v1/${endpoint}`)
  url.searchParams.set('apikey', CRICKETDATA_API_KEY ?? '')
  url.searchParams.set('offset', '0')

  const response = await fetch(url.toString())
  if (!response.ok) {
    return null
  }

  const payload = asRecord((await response.json()) as unknown)
  const status = asString(payload.status).toLowerCase()
  if (status !== 'success') {
    return null
  }

  return asArray(payload.data)
}

export async function getLiveMatchesWithOdds(): Promise<Match[] | null> {
  if (!CRICKETDATA_API_KEY) {
    return null
  }

  if (matchesCache && Date.now() - matchesCache.at < MATCH_CACHE_MS) {
    return matchesCache.data
  }

  try {
    const oddsPairs = await fetchOddsPairs()
    const currentRows = await fetchCricapiRows('currentMatches')
    const currentMatches = (currentRows ?? [])
      .map((row) => mapCricapiMatch(asRecord(row), oddsPairs))
      .filter((match): match is Match => match !== null)
      .sort((left, right) => Number(right.isLive) - Number(left.isLive))

    if (currentMatches.length > 0) {
      matchesCache = { at: Date.now(), data: currentMatches }
      return currentMatches
    }

    const scoreRows = await fetchCricapiRows('cricScore')
    const fallbackMatches = (scoreRows ?? [])
      .map((row) => mapCricScoreMatch(asRecord(row), oddsPairs))
      .filter((match): match is Match => match !== null)
      .sort((left, right) => Number(right.isLive) - Number(left.isLive))

    if (fallbackMatches.length === 0) {
      return null
    }

    matchesCache = { at: Date.now(), data: fallbackMatches }
    return fallbackMatches
  } catch {
    return null
  }
}

export async function getLiveMarketsForMatch(match: Match): Promise<GameMarket[] | null> {
  const matches = await getLiveMatchesWithOdds()
  if (!matches) {
    return null
  }

  const latest =
    matches.find((candidate) => candidate.id === match.id) ??
    matches.find(
      (candidate) =>
        normalizeTeamName(candidate.teamAFull) === normalizeTeamName(match.teamAFull) &&
        normalizeTeamName(candidate.teamBFull) === normalizeTeamName(match.teamBFull),
    )

  return buildMarkets(latest ?? match)
}
