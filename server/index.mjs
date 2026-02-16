import 'dotenv/config'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { Server as SocketIOServer } from 'socket.io'
import { load as loadHtml } from 'cheerio'
import pino from 'pino'
import pinoHttp from 'pino-http'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, 'dist')
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, 'index.html')

const PORT = Number(process.env.PORT ?? 8787)
const SERVE_FRONTEND = String(process.env.SERVE_FRONTEND ?? 'false').trim().toLowerCase() === 'true'
const CRICKETDATA_API_KEY =
  process.env.CRICKETDATA_API_KEY ?? process.env.VITE_CRICKETDATA_API_KEY ?? ''
const ODDS_API_KEY = process.env.ODDS_API_KEY ?? process.env.VITE_ODDS_API_KEY ?? ''
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? 'admin-local-key'
const STARTING_BALANCE = Number(process.env.STARTING_BALANCE ?? 100)
const POLL_INTERVAL_MS = Math.max(10_000, Number(process.env.POLL_INTERVAL_MS ?? 30_000))
const STALE_AFTER_MS = Math.max(POLL_INTERVAL_MS * 2, Number(process.env.STALE_AFTER_MS ?? 120_000))
const MAX_USER_EXPOSURE = Math.max(1000, Number(process.env.MAX_USER_EXPOSURE ?? 50_000))
const MAX_MATCH_EXPOSURE = Math.max(5000, Number(process.env.MAX_MATCH_EXPOSURE ?? 250_000))
const MARKET_HISTORY_LIMIT = Math.max(60, Number(process.env.MARKET_HISTORY_LIMIT ?? 480))
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30)

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim()
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const DISABLE_AUTH_FOR_TESTING = String(process.env.DISABLE_AUTH_FOR_TESTING ?? 'false').trim().toLowerCase() === 'true'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null

if (!supabaseAdmin) {
  logger.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — auth verification disabled, withdrawal endpoints unavailable')
}

const ODDS_REGIONS = (process.env.ODDS_REGIONS ?? 'uk').trim()
const ODDS_SPORT_KEYS = (process.env.ODDS_SPORT_KEYS ?? '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
  .slice(0, 8)

const DCRIC99_ENABLED = (process.env.DCRIC99_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
const DCRIC99_EVENT_LIST_URL = (
  process.env.DCRIC99_EVENT_LIST_URL ?? 'https://api.dcric99.com/api/guest/event_list'
)
  .trim()
const DCRIC99_EVENT_DETAIL_URL = (
  process.env.DCRIC99_EVENT_DETAIL_URL ?? 'https://api.dcric99.com/api/guest/event'
)
  .trim()
  .replace(/\/$/, '')
const DCRIC99_DEFAULT_ODDS_BASE_URL = (
  process.env.DCRIC99_DEFAULT_ODDS_BASE_URL ?? 'https://api.dcric99.com'
)
  .trim()
  .replace(/\/$/, '')
const DCRIC99_CONCURRENCY = clampToInt(process.env.DCRIC99_CONCURRENCY, 6, 1, 10)
const DCRIC99_MAX_EVENT_DETAILS = clampToInt(process.env.DCRIC99_MAX_EVENT_DETAILS, 60, 10, 120)
const DCRIC99_MIN_SCORE = clampToFloat(process.env.DCRIC99_MIN_SCORE, 0.75, 0.3, 2)

const scraperSiteConfigs = parseScraperSiteConfig(process.env.ODDS_SCRAPER_SITES_JSON)

const FLAG_BY_CODE = {
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
  'vs',
  'v',
])

const state = {
  fetchedAt: 0,
  stale: true,
  feedSource: 'mock',
  matches: [],
  marketsByMatch: new Map(),
  marketStatusByMatch: new Map(),
  historyByMarketKey: new Map(),
  users: new Map(),
  positionsByUser: new Map(),
  orders: [],
  settlementsByMatch: new Map(),
  thresholdLockByMatchMarket: new Map(),
  audits: [],
}

let refreshPromise = null
let io = null

function clampToInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(min, Math.min(max, parsed))
}

function clampToFloat(raw, fallback, min, max) {
  const parsed = Number.parseFloat(String(raw ?? ''))
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(min, Math.min(max, parsed))
}

function parseScraperSiteConfig(raw) {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((entry) => (typeof entry === 'object' && entry !== null ? entry : null))
      .filter(Boolean)
      .map((entry) => ({
        name: String(entry.name ?? '').trim(),
        url: String(entry.url ?? '').trim(),
        format: String(entry.format ?? 'html').trim().toLowerCase(),
        eventSelector: String(entry.eventSelector ?? '.event').trim(),
        homeSelector: String(entry.homeSelector ?? '.home').trim(),
        awaySelector: String(entry.awaySelector ?? '.away').trim(),
        homeOddsSelector: String(entry.homeOddsSelector ?? '.home-odds').trim(),
        awayOddsSelector: String(entry.awayOddsSelector ?? '.away-odds').trim(),
        eventsPath: String(entry.eventsPath ?? 'events').trim(),
        homeField: String(entry.homeField ?? 'home').trim(),
        awayField: String(entry.awayField ?? 'away').trim(),
        homeOddsField: String(entry.homeOddsField ?? 'homeOdds').trim(),
        awayOddsField: String(entry.awayOddsField ?? 'awayOdds').trim(),
      }))
      .filter((entry) => entry.name && entry.url)
  } catch {
    return []
  }
}

function nowIso() {
  return new Date().toISOString()
}

function asRecord(value) {
  return typeof value === 'object' && value !== null ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value, fallback = 0) {
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clampPrice(value) {
  return clamp(Math.round(value), 1, 99)
}

function clampProbability(value) {
  return clamp(value, 0.01, 0.99)
}

function hashToInt(input) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash) + 1
}

function normalizeTeamName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeTeamName(name) {
  return normalizeTeamName(name)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function tokenOverlap(left, right) {
  const leftTokens = tokenizeTeamName(left)
  const rightTokens = tokenizeTeamName(right)

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0
  }

  const rightSet = new Set(rightTokens)
  const hits = leftTokens.filter((token) => rightSet.has(token)).length
  return hits / Math.max(leftTokens.length, rightTokens.length)
}

function shortCode(name) {
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

function resolveFlag(shortCodeValue) {
  return FLAG_BY_CODE[String(shortCodeValue ?? '').toUpperCase()] ?? '🏏'
}

function parseTeamLabel(raw) {
  const value = String(raw ?? '').trim()
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

function parseCricketOvers(rawOvers) {
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

  const legalBalls = clamp(ballDigit, 0, 5)
  return wholeOvers + legalBalls / 6
}

function parseCompactScore(rawScore) {
  const value = String(rawScore ?? '').trim()
  if (!value) {
    return {
      score: 'Yet to bat',
      overs: '',
      runs: 0,
      wickets: 0,
      hasScore: false,
      oversValue: null,
    }
  }

  const parsed = value.match(/(\d+)\s*\/\s*(\d+)(?:\s*\(([\d.]+)\))?/)
  if (!parsed) {
    return {
      score: value,
      overs: '',
      runs: 0,
      wickets: 0,
      hasScore: false,
      oversValue: null,
    }
  }

  const runs = Number.parseInt(parsed[1], 10)
  const wickets = Number.parseInt(parsed[2], 10)
  const safeRuns = Number.isFinite(runs) ? runs : 0
  const safeWickets = Number.isFinite(wickets) ? wickets : 0
  const overs = (parsed[3] ?? '').trim()

  return {
    score: `${Math.max(0, safeRuns)}/${Math.max(0, safeWickets)}`,
    overs,
    runs: Math.max(0, safeRuns),
    wickets: Math.max(0, safeWickets),
    hasScore: true,
    oversValue: parseCricketOvers(overs),
  }
}

function parseSlashScore(rawScore, rawOvers) {
  const scoreText = String(rawScore ?? '').trim()
  const parsed = scoreText.match(/(\d+)\s*\/\s*(\d+)/)

  const runs = parsed ? Number.parseInt(parsed[1], 10) : 0
  const wickets = parsed ? Number.parseInt(parsed[2], 10) : 0
  const safeRuns = Number.isFinite(runs) ? runs : 0
  const safeWickets = Number.isFinite(wickets) ? wickets : 0
  const oversText = String(rawOvers ?? '').trim()

  return {
    score: parsed ? `${safeRuns}/${safeWickets}` : scoreText || 'Yet to bat',
    overs: oversText,
    runs: safeRuns,
    wickets: safeWickets,
    hasScore: parsed !== null,
    oversValue: parseCricketOvers(oversText),
  }
}

function parseThresholdFromLabel(label) {
  const parsed = String(label ?? '').match(/(over|under)\s+([\d.]+)/i)
  if (!parsed) return null
  const threshold = parseFloat(parsed[2])
  if (!Number.isFinite(threshold)) return null
  return {
    direction: parsed[1].toLowerCase(),
    threshold,
  }
}

function syntheticVolume(seed) {
  const base = (hashToInt(seed) % 70) + 30
  return `${(base / 10).toFixed(1)}L`
}

function inferCategory(matchName, matchType) {
  const name = String(matchName ?? '').toLowerCase()
  const type = String(matchType ?? '').toLowerCase()

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

function inferIsLiveFromStatus(statusText) {
  const status = String(statusText ?? '').toLowerCase()
  return (
    status.includes('live') ||
    status.includes('innings') ||
    status.includes('in progress') ||
    status.includes('running') ||
    status.includes('need')
  )
}

function inferLiveFromMode(mode, statusText, scoreAState, scoreBState) {
  const normalizedMode = String(mode ?? '').trim().toLowerCase()
  const normalizedStatus = String(statusText ?? '').trim().toLowerCase()

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

  if (inferIsLiveFromStatus(statusText)) {
    return true
  }

  return scoreAState.hasScore || scoreBState.hasScore
}

function formatTimeLabel(statusText, dateTimeGmt, fallbackDate) {
  if (inferIsLiveFromStatus(statusText)) {
    return 'Now'
  }

  const parsedDate = Date.parse(String(dateTimeGmt ?? ''))
  if (Number.isFinite(parsedDate)) {
    return new Date(parsedDate).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return String(fallbackDate ?? '').trim() || 'Upcoming'
}

function inferLimitedOvers(matchName, matchType) {
  const text = `${matchName ?? ''} ${matchType ?? ''}`.toLowerCase()

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

function inferParScore(totalOvers) {
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

function detectWinnerFromStatus(statusText, teamAFull, teamBFull) {
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

function computeModeledPriceA(params) {
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

  if (isLive && totalOvers && hasB && (scoreB.oversValue ?? 0) > 0.2) {
    const chaseOvers = Math.max(0.1, scoreB.oversValue ?? 0)
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
  } else if (isLive && totalOvers && hasA && (scoreA.oversValue ?? 0) > 0.5) {
    const battingOvers = Math.max(0.1, scoreA.oversValue ?? 0)
    const projected = (scoreA.runs / battingOvers) * totalOvers
    const par = inferParScore(totalOvers)
    probabilityA += Math.tanh((projected - par) / 40) * 0.16
    probabilityA += Math.tanh((4 - scoreA.wickets) / 2.8) * 0.09
  }

  return clampPrice(clampProbability(probabilityA) * 100)
}

function parseTeamsFromName(name) {
  const head = String(name ?? '').split(',')[0]?.trim() ?? ''
  if (!head) {
    return null
  }

  const parts = head.split(/\s+vs\s+|\s+v\s+/i)
  if (parts.length < 2) {
    return null
  }

  return [parts[0].trim(), parts[1].trim()]
}

function mapCurrentMatch(row) {
  const rawId = asString(row.id, asString(row.unique_id, asString(row.name, '')))
  if (!rawId) {
    return null
  }

  const name = asString(row.name, 'Cricket Match')
  const matchType = asString(row.matchType)
  const statusText = asString(row.status)
  const dateLabel = asString(row.date)
  const dateTimeGmt = asString(row.dateTimeGMT)

  const teamInfo = asArray(row.teamInfo).map(asRecord)
  const listedTeams = asArray(row.teams)
    .map((team) => asString(team))
    .filter(Boolean)
  const parsedTeams = parseTeamsFromName(name)

  const teamAFull =
    asString(asRecord(teamInfo[0]).name) || listedTeams[0] || parsedTeams?.[0] || 'Team A'
  const teamBFull =
    asString(asRecord(teamInfo[1]).name) || listedTeams[1] || parsedTeams?.[1] || 'Team B'

  const teamA = asString(asRecord(teamInfo[0]).shortname) || shortCode(teamAFull)
  const teamB = asString(asRecord(teamInfo[1]).shortname) || shortCode(teamBFull)

  const scoreRows = asArray(row.score).map(asRecord)
  const scoreAEntry =
    scoreRows.find((entry) =>
      normalizeTeamName(asString(entry.inning)).includes(normalizeTeamName(teamAFull)),
    ) ?? scoreRows[0]
  const scoreBEntry =
    scoreRows.find((entry) =>
      normalizeTeamName(asString(entry.inning)).includes(normalizeTeamName(teamBFull)),
    ) ?? scoreRows[1]

  const scoreAState = {
    runs: asNumber(scoreAEntry?.r, 0),
    wickets: asNumber(scoreAEntry?.w, 0),
    oversValue: parseCricketOvers(scoreAEntry?.o),
    hasScore: Boolean(scoreAEntry),
  }
  const scoreBState = {
    runs: asNumber(scoreBEntry?.r, 0),
    wickets: asNumber(scoreBEntry?.w, 0),
    oversValue: parseCricketOvers(scoreBEntry?.o),
    hasScore: Boolean(scoreBEntry),
  }

  const scoreA = parseSlashScore(
    `${Math.round(scoreAState.runs)}/${Math.round(scoreAState.wickets)}`,
    scoreAState.oversValue ?? '',
  )
  const scoreB = scoreBEntry
    ? parseSlashScore(
        `${Math.round(scoreBState.runs)}/${Math.round(scoreBState.wickets)}`,
        scoreBState.oversValue ?? '',
      )
    : parseCompactScore('')

  return {
    id: hashToInt(rawId),
    externalId: rawId,
    teamA,
    teamB,
    teamAFull,
    teamBFull,
    flagA: resolveFlag(teamA),
    flagB: resolveFlag(teamB),
    scoreA: scoreA.score,
    scoreB: scoreB.score,
    oversA: scoreA.overs,
    oversB: scoreB.overs,
    priceA: 50,
    priceB: 50,
    volume: syntheticVolume(rawId),
    time: formatTimeLabel(statusText, dateTimeGmt, dateLabel),
    isLive: inferIsLiveFromStatus(statusText),
    category: inferCategory(name, matchType),
    marketsCount: 16,
    statusText,
    matchType,
    matchName: name,
  }
}

function mapCricScoreMatch(row) {
  const rawId = asString(row.id)
  if (!rawId) {
    return null
  }

  const teamARaw = asString(row.t1)
  const teamBRaw = asString(row.t2)
  if (!teamARaw || !teamBRaw) {
    return null
  }

  const teamAInfo = parseTeamLabel(teamARaw)
  const teamBInfo = parseTeamLabel(teamBRaw)

  const matchType = asString(row.matchType)
  const statusText = asString(row.status)
  const dateTimeGmt = asString(row.dateTimeGMT)
  const series = asString(row.series, 'Cricket Match')
  const dateLabel = asString(row.date)
  const matchMode = asString(row.ms).toLowerCase()

  const scoreA = parseCompactScore(asString(row.t1s))
  const scoreB = parseCompactScore(asString(row.t2s))

  const isLive = inferLiveFromMode(matchMode, statusText, scoreA, scoreB)

  return {
    id: hashToInt(rawId),
    externalId: rawId,
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
    priceA: 50,
    priceB: 50,
    volume: syntheticVolume(rawId),
    time: isLive ? 'Now' : formatTimeLabel(statusText, dateTimeGmt, dateLabel || statusText),
    isLive,
    category: inferCategory(series, matchType),
    marketsCount: 16,
    statusText,
    matchType,
    matchName: series,
  }
}

function parseMatchScoreState(match) {
  const scoreA = parseCompactScore(`${match.scoreA}${match.oversA ? ` (${match.oversA})` : ''}`)
  const scoreB = parseCompactScore(`${match.scoreB}${match.oversB ? ` (${match.oversB})` : ''}`)

  return { scoreA, scoreB }
}

function findOddsForMatch(match, oddsPairs) {
  const teamA = match.teamAFull
  const teamB = match.teamBFull

  const normalizedA = normalizeTeamName(teamA)
  const normalizedB = normalizeTeamName(teamB)

  for (const pair of oddsPairs) {
    const pairA = normalizeTeamName(pair.teamA)
    const pairB = normalizeTeamName(pair.teamB)

    if (pairA === normalizedA && pairB === normalizedB) {
      return { priceA: pair.priceA, priceB: pair.priceB, source: pair.provider, secondaryMarkets: pair.secondaryMarkets ?? [] }
    }

    if (pairA === normalizedB && pairB === normalizedA) {
      return { priceA: pair.priceB, priceB: pair.priceA, source: pair.provider, secondaryMarkets: pair.secondaryMarkets ?? [] }
    }
  }

  let bestScore = 0
  let bestMatch = null
  let bestSecondary = []

  for (const pair of oddsPairs) {
    const directScore = tokenOverlap(teamA, pair.teamA) + tokenOverlap(teamB, pair.teamB)
    if (directScore > bestScore) {
      bestScore = directScore
      bestMatch = { priceA: pair.priceA, priceB: pair.priceB, source: pair.provider }
      bestSecondary = pair.secondaryMarkets ?? []
    }

    const swappedScore = tokenOverlap(teamA, pair.teamB) + tokenOverlap(teamB, pair.teamA)
    if (swappedScore > bestScore) {
      bestScore = swappedScore
      bestMatch = { priceA: pair.priceB, priceB: pair.priceA, source: pair.provider }
      bestSecondary = pair.secondaryMarkets ?? []
    }
  }

  if (bestScore < 1.1) {
    return null
  }

  return { ...bestMatch, secondaryMarkets: bestSecondary }
}

function applyPricing(matches, oddsPairs) {
  let hasExternalOdds = false

  const pricedMatches = matches.map((match) => {
    const { scoreA, scoreB } = parseMatchScoreState(match)

    const modeledPriceA = computeModeledPriceA({
      rawId: String(match.externalId ?? match.id),
      matchName: match.matchName,
      matchType: match.matchType,
      statusText: match.statusText,
      isLive: match.isLive,
      teamAFull: match.teamAFull,
      teamBFull: match.teamBFull,
      scoreA,
      scoreB,
    })

    const matchedOdds = findOddsForMatch(match, oddsPairs)
    if (matchedOdds) {
      hasExternalOdds = true
    }

    const priceA = clampPrice(matchedOdds?.priceA ?? modeledPriceA)
    const priceB = clampPrice(matchedOdds?.priceB ?? 100 - priceA)

    return {
      ...match,
      priceA,
      priceB,
      oddsSource: matchedOdds?.source ?? 'modeled',
      externalMarkets: matchedOdds?.secondaryMarkets ?? [],
    }
  })

  return {
    pricedMatches,
    feedSource: hasExternalOdds ? 'cricket+external_odds' : 'cricket+modeled_odds',
  }
}

function buildSyntheticMatchFromOddsPair(pair) {
  const teamAInfo = parseTeamLabel(pair.teamA)
  const teamBInfo = parseTeamLabel(pair.teamB)
  const syntheticId = `${pair.provider}:${normalizeTeamName(teamAInfo.full)}:${normalizeTeamName(teamBInfo.full)}`

  return {
    id: hashToInt(syntheticId),
    externalId: syntheticId,
    teamA: teamAInfo.short,
    teamB: teamBInfo.short,
    teamAFull: teamAInfo.full,
    teamBFull: teamBInfo.full,
    flagA: resolveFlag(teamAInfo.short),
    flagB: resolveFlag(teamBInfo.short),
    scoreA: '',
    scoreB: '',
    oversA: '',
    oversB: '',
    priceA: clampPrice(pair.priceA),
    priceB: clampPrice(pair.priceB),
    volume: syntheticVolume(syntheticId),
    time: 'Now',
    isLive: true,
    category: 'Cricket',
    marketsCount: 16,
    statusText: `Live odds (${pair.provider})`,
    matchType: 'odds_feed',
    matchName: `${teamAInfo.full} vs ${teamBInfo.full}`,
    oddsSource: pair.provider,
  }
}

function buildSyntheticMatchesFromOddsPairs(oddsPairs) {
  const dedupedPairs = new Map()

  for (const pair of oddsPairs) {
    const normalizedA = normalizeTeamName(pair.teamA)
    const normalizedB = normalizeTeamName(pair.teamB)
    if (!normalizedA || !normalizedB || normalizedA === normalizedB) {
      continue
    }

    const directKey = `${normalizedA}:${normalizedB}`
    const reverseKey = `${normalizedB}:${normalizedA}`

    if (dedupedPairs.has(directKey) || dedupedPairs.has(reverseKey)) {
      continue
    }

    dedupedPairs.set(directKey, pair)
  }

  return [...dedupedPairs.values()].map((pair) => buildSyntheticMatchFromOddsPair(pair))
}

async function fetchJson(url, timeoutMs = 20_000, label = 'unknown') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startTime = Date.now()

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'yesno-gateway/1.0',
      },
    })

    const duration = Date.now() - startTime

    if (!response.ok) {
      logger.warn({ label, url: url.split('?')[0], status: response.status, duration }, 'API returned non-OK status')
      return null
    }

    const data = await response.json()
    logger.debug({ label, url: url.split('?')[0], status: response.status, duration }, 'API call succeeded')
    return data
  } catch (err) {
    const duration = Date.now() - startTime
    const isTimeout = err.name === 'AbortError'

    logger.error({
      label,
      url: url.split('?')[0],
      error: err.message,
      isTimeout,
      duration
    }, isTimeout ? 'API call timed out' : 'API call failed')

    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchCricapiRows(endpoint) {
  if (!CRICKETDATA_API_KEY) {
    return []
  }

  const url = new URL(`https://api.cricapi.com/v1/${endpoint}`)
  url.searchParams.set('apikey', CRICKETDATA_API_KEY)
  url.searchParams.set('offset', '0')

  const payload = asRecord(await fetchJson(url.toString(), 25_000, `cricapi_${endpoint}`))
  const status = asString(payload.status).toLowerCase()

  if (status !== 'success') {
    logger.warn({ endpoint, status }, 'CricAPI returned non-success status')
    return []
  }

  return asArray(payload.data)
}

async function fetchCricketMatches() {
  if (!CRICKETDATA_API_KEY) {
    return []
  }

  const [scoreRows, currentRows] = await Promise.all([
    fetchCricapiRows('cricScore'),
    fetchCricapiRows('currentMatches'),
  ])

  const mergedByExternalId = new Map()

  for (const row of scoreRows) {
    const mapped = mapCricScoreMatch(asRecord(row))
    if (!mapped) {
      continue
    }

    mergedByExternalId.set(mapped.externalId, mapped)
  }

  for (const row of currentRows) {
    const mapped = mapCurrentMatch(asRecord(row))
    if (!mapped) {
      continue
    }

    mergedByExternalId.set(mapped.externalId, {
      ...mergedByExternalId.get(mapped.externalId),
      ...mapped,
    })
  }

  return [...mergedByExternalId.values()].sort((left, right) => Number(right.isLive) - Number(left.isLive))
}

function parseOddsProbability(raw) {
  const value = String(raw ?? '').trim()
  if (!value) {
    return null
  }

  if (value.endsWith('%')) {
    const parsedPercent = Number.parseFloat(value.slice(0, -1))
    if (!Number.isFinite(parsedPercent)) {
      return null
    }

    return clampProbability(parsedPercent / 100)
  }

  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (numeric > 1.0 && numeric < 100.0) {
    return clampProbability(1 / numeric)
  }

  if (numeric > 0.0 && numeric <= 1.0) {
    return clampProbability(numeric)
  }

  return null
}

function toPricePair(probabilityA, probabilityB) {
  const total = probabilityA + probabilityB
  if (!Number.isFinite(total) || total <= 0) {
    return null
  }

  const normalizedA = clampPrice((probabilityA / total) * 100)
  const normalizedB = clampPrice(100 - normalizedA)

  return {
    priceA: normalizedA,
    priceB: normalizedB,
  }
}

async function fetchTheOddsSports() {
  if (!ODDS_API_KEY) {
    return []
  }

  if (ODDS_SPORT_KEYS.length > 0) {
    return ODDS_SPORT_KEYS
  }

  const url = new URL('https://api.the-odds-api.com/v4/sports/')
  url.searchParams.set('apiKey', ODDS_API_KEY)

  const payload = asArray(await fetchJson(url.toString(), 10_000, 'theodds_sports'))
  return payload
    .map((entry) => asString(asRecord(entry).key))
    .filter((key) => key.startsWith('cricket_'))
    .slice(0, 8)
}

function parseTheOddsPair(entry) {
  const homeTeam = asString(entry.home_team)
  const awayTeam = asString(entry.away_team)

  if (!homeTeam || !awayTeam) {
    return null
  }

  const bookmakers = asArray(entry.bookmakers).map(asRecord)
  let outcomes = []

  for (const bookmaker of bookmakers) {
    const markets = asArray(bookmaker.markets).map(asRecord)
    const h2h = markets.find((market) => asString(market.key) === 'h2h') ?? markets[0]
    if (!h2h) {
      continue
    }

    const candidates = asArray(h2h.outcomes).map(asRecord)
    if (candidates.length >= 2) {
      outcomes = candidates
      break
    }
  }

  if (outcomes.length < 2) {
    return null
  }

  const homeOutcome = outcomes.find(
    (outcome) => normalizeTeamName(asString(outcome.name)) === normalizeTeamName(homeTeam),
  )
  const awayOutcome = outcomes.find(
    (outcome) => normalizeTeamName(asString(outcome.name)) === normalizeTeamName(awayTeam),
  )

  const homePrice = asNumber(homeOutcome?.price, 0)
  const awayPrice = asNumber(awayOutcome?.price, 0)

  const homeProbability = parseOddsProbability(homePrice)
  const awayProbability = parseOddsProbability(awayPrice)

  if (!homeProbability || !awayProbability) {
    return null
  }

  const pair = toPricePair(homeProbability, awayProbability)
  if (!pair) {
    return null
  }

  return {
    teamA: homeTeam,
    teamB: awayTeam,
    ...pair,
    provider: 'the-odds-api',
  }
}

async function fetchTheOddsPairs() {
  if (!ODDS_API_KEY) {
    return []
  }

  const sportKeys = await fetchTheOddsSports()
  if (sportKeys.length === 0) {
    return []
  }

  const eventsBySport = await Promise.all(
    sportKeys.map(async (sportKey) => {
      const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`)
      url.searchParams.set('apiKey', ODDS_API_KEY)
      url.searchParams.set('regions', ODDS_REGIONS)
      url.searchParams.set('markets', 'h2h')
      url.searchParams.set('oddsFormat', 'decimal')
      url.searchParams.set('dateFormat', 'iso')

      const payload = asArray(await fetchJson(url.toString(), 10_000, `theodds_${sportKey}`))
      return payload
        .map((event) => parseTheOddsPair(asRecord(event)))
        .filter((pair) => pair !== null)
    }),
  )

  return eventsBySport.flat()
}

function buildMatchLabelForScoring(match) {
  return `${match.teamAFull ?? match.teamA ?? ''} ${match.teamBFull ?? match.teamB ?? ''}`.trim()
}

function scoreDcricEventCandidate(eventName, matches) {
  const label = String(eventName ?? '').trim()
  if (!label || matches.length === 0) {
    return 0
  }

  const parsedTeams = parseTeamsFromName(label)
  let best = 0

  for (const match of matches) {
    const matchLabel = buildMatchLabelForScoring(match)
    best = Math.max(best, tokenOverlap(label, matchLabel))

    if (parsedTeams) {
      best = Math.max(
        best,
        tokenOverlap(match.teamAFull, parsedTeams[0]) + tokenOverlap(match.teamBFull, parsedTeams[1]),
      )
      best = Math.max(
        best,
        tokenOverlap(match.teamAFull, parsedTeams[1]) + tokenOverlap(match.teamBFull, parsedTeams[0]),
      )
    }
  }

  return best
}

function buildDcricSelectionNameMap(eventPayload) {
  const namesBySelectionId = new Map()

  for (const market of asArray(eventPayload.markets)) {
    for (const runner of asArray(market?.runners)) {
      const selectionId = asString(runner?.selection_id).trim()
      const name = asString(runner?.name).trim()

      if (selectionId && name && !namesBySelectionId.has(selectionId)) {
        namesBySelectionId.set(selectionId, name)
      }
    }
  }

  for (const book of asArray(eventPayload.book_makers)) {
    for (const runner of asArray(book?.book_maker_odds)) {
      const selectionId = asString(runner?.selection_id).trim()
      const name = asString(runner?.name).trim()

      if (selectionId && name && !namesBySelectionId.has(selectionId)) {
        namesBySelectionId.set(selectionId, name)
      }
    }
  }

  return namesBySelectionId
}

function buildDcricMarketNameMap(eventPayload) {
  const namesByMarketId = new Map()

  for (const value of Object.values(eventPayload)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        const rec = asRecord(row)
        const mId = asString(rec.market_id).trim()
        const mName = (
          asString(rec.name) ||
          asString(rec.market_name) ||
          asString(rec.fancy_name) ||
          asString(rec.runnerName)
        ).trim()

        if (mId && mName && !namesByMarketId.has(mId)) {
          namesByMarketId.set(mId, mName)
        }
      }
    }
  }

  return namesByMarketId
}

function buildDcricMarketIds(eventPayload) {
  const marketIds = []

  for (const value of Object.values(eventPayload)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        const marketId = asString(asRecord(row).market_id).trim()
        if (marketId) {
          marketIds.push(marketId)
        }
      }
      continue
    }

    if (typeof value === 'object' && value !== null) {
      const marketId = asString(asRecord(value).market_id).trim()
      if (marketId) {
        marketIds.push(marketId)
      }
    }
  }

  return [...new Set(marketIds)].slice(0, 200)
}

function parseDcricPriceProbability(rawPrice) {
  const numeric = asNumber(rawPrice, 0)
  if (numeric <= 0) {
    return null
  }

  if (numeric >= 50 && numeric <= 1000) {
    // Dcric bookmaker style: 107 means 1.07 net odds.
    return clampProbability(1 / (1 + numeric / 100))
  }

  if (numeric > 1 && numeric < 100) {
    return clampProbability(1 / numeric)
  }

  if (numeric <= 1) {
    return clampProbability(numeric)
  }

  return null
}

function parseDcricOddsRows(rows, detailPayload) {
  const marketKeys = asRecord(detailPayload.market_odds_keys)
  const marketIdIndex = asNumber(marketKeys.market_id, -1)
  const skipKeys = Math.max(0, Math.floor(asNumber(marketKeys.skip_keys, 8)))
  const runnerKey = Math.max(1, Math.floor(asNumber(marketKeys.runner_key, 14)))

  if (marketIdIndex < 0) {
    return []
  }

  const selectionNames = buildDcricSelectionNameMap(asRecord(detailPayload.event))
  const marketNames = buildDcricMarketNameMap(asRecord(detailPayload.event))
  const markets = []

  for (const row of rows) {
    const fields = String(row ?? '').split('|')
    if (fields.length <= skipKeys) {
      continue
    }

    const marketId = asString(fields[marketIdIndex]).trim()
    if (!marketId) {
      continue
    }

    const runners = []
    for (let index = skipKeys; index < fields.length; index += runnerKey) {
      const selectionId = asString(fields[index]).trim()
      if (!selectionId) {
        continue
      }

      const backTop = asNumber(fields[index + 2], 0)
      const layTop = asNumber(fields[index + 8], 0)
      const prices = [backTop, layTop].filter((price) => price > 0)
      const odds = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0

      runners.push({
        selectionId,
        name: selectionNames.get(selectionId) ?? '',
        odds,
      })
    }

    if (runners.length >= 2) {
      markets.push({
        marketId,
        marketName: marketNames.get(marketId) ?? '',
        runners,
      })
    }
  }

  return markets
}

/* ---------------------------------------------------------------------------
 * Secondary market classification — maps Dcric99 fancy/session/bookmaker
 * markets to our market IDs 2-8 using regex on the market name and runner
 * name structure.
 * --------------------------------------------------------------------------- */

const MARKET_CLASSIFIERS = [
  {
    marketId: 2,
    marketNamePatterns: [/toss/i],
    runnerType: 'team',
    defaultThreshold: null,
  },
  {
    marketId: 3,
    marketNamePatterns: [/power\s*play/i, /\bpp\b/i, /6\s*over\s*run/i, /first\s*6/i],
    runnerType: 'overunder',
    defaultThreshold: 48.5,
  },
  {
    marketId: 4,
    marketNamePatterns: [/10\s*over/i, /first\s*10/i, /10\s*ov\b/i],
    runnerType: 'overunder',
    defaultThreshold: 82.5,
  },
  {
    marketId: 5,
    marketNamePatterns: [/top\s*bat/i, /batt?(?:er|sman)/i, /30\s*run/i, /highest\s*score/i],
    runnerType: 'yesno',
    defaultThreshold: 30,
  },
  {
    marketId: 6,
    marketNamePatterns: [/wicket/i, /\bwkt/i, /fall\s*of/i],
    runnerType: 'overunder',
    defaultThreshold: 6.5,
  },
  {
    marketId: 7,
    marketNamePatterns: [/over\s*20/i, /20th\s*over/i, /20\s*over\s*run/i],
    runnerType: 'overunder',
    defaultThreshold: 10.5,
  },
  {
    marketId: 8,
    marketNamePatterns: [/odd.*even/i, /even.*odd/i, /total.*odd/i, /total.*even/i],
    runnerType: 'oddeven',
    defaultThreshold: null,
  },
]

function classifyDcricMarket(market) {
  const mName = String(market.marketName ?? '').trim()
  if (!mName) return null

  for (const classifier of MARKET_CLASSIFIERS) {
    const matched = classifier.marketNamePatterns.some((pattern) => pattern.test(mName))
    if (!matched) continue

    const activeRunners = market.runners.filter((r) => r.odds > 0)
    if (activeRunners.length < 2) continue

    // Pick first two active runners
    const [runnerA, runnerB] = activeRunners
    const nameA = asString(runnerA.name).trim()
    const nameB = asString(runnerB.name).trim()

    let labelA = nameA
    let labelB = nameB
    let threshold = null
    let confidence = 0.5

    if (classifier.runnerType === 'overunder') {
      // Runner names should contain "over" / "under" or a numeric threshold
      const parsedA = parseThresholdFromLabel(nameA)
      const parsedB = parseThresholdFromLabel(nameB)

      if (parsedA && parsedB) {
        // Both runners have parseable thresholds — high confidence
        threshold = parsedA.threshold
        confidence = 1.0
      } else if (parsedA) {
        threshold = parsedA.threshold
        // Infer the other runner label
        labelB = parsedA.direction === 'over' ? `Under ${parsedA.threshold}` : `Over ${parsedA.threshold}`
        confidence = 0.8
      } else if (parsedB) {
        threshold = parsedB.threshold
        labelA = parsedB.direction === 'under' ? `Over ${parsedB.threshold}` : `Under ${parsedB.threshold}`
        confidence = 0.8
      } else {
        // Neither runner has parseable over/under — use default threshold
        threshold = classifier.defaultThreshold
        labelA = `Over ${classifier.defaultThreshold}`
        labelB = `Under ${classifier.defaultThreshold}`
        confidence = 0.4
      }
    } else if (classifier.runnerType === 'oddeven') {
      const lowerA = nameA.toLowerCase()
      const lowerB = nameB.toLowerCase()
      if (
        (lowerA.includes('odd') && lowerB.includes('even')) ||
        (lowerA.includes('even') && lowerB.includes('odd'))
      ) {
        labelA = lowerA.includes('odd') ? 'Odd' : 'Even'
        labelB = lowerA.includes('odd') ? 'Even' : 'Odd'
        confidence = 1.0
      } else {
        continue // Runners don't match odd/even pattern
      }
    } else if (classifier.runnerType === 'yesno') {
      const lowerA = nameA.toLowerCase()
      const lowerB = nameB.toLowerCase()
      if (
        (lowerA === 'yes' || lowerA === 'no') &&
        (lowerB === 'yes' || lowerB === 'no')
      ) {
        labelA = lowerA === 'yes' ? 'Yes' : 'No'
        labelB = lowerA === 'yes' ? 'No' : 'Yes'
        confidence = 0.9
      } else {
        // Treat as generic two-runner — keep original labels
        confidence = 0.5
      }
    } else if (classifier.runnerType === 'team') {
      // Team runners — keep the team names as labels
      if (!nameA || !nameB) continue
      confidence = 0.7
    }

    // Convert odds to prices
    const probA = parseDcricPriceProbability(runnerA.odds)
    const probB = parseDcricPriceProbability(runnerB.odds)
    if (!probA || !probB) continue

    const pair = toPricePair(probA, probB)
    if (!pair) continue

    return {
      marketId: classifier.marketId,
      threshold,
      priceA: pair.priceA,
      priceB: pair.priceB,
      labelA,
      labelB,
      source: 'dcric99',
      confidence,
    }
  }

  return null
}

function extractSecondaryMarkets(parsedMarkets) {
  const results = []

  for (const market of parsedMarkets) {
    const classified = classifyDcricMarket(market)
    if (classified) {
      results.push(classified)
    }
  }

  // Deduplicate: keep the highest confidence entry per marketId
  const bestByMarketId = new Map()
  for (const entry of results) {
    const existing = bestByMarketId.get(entry.marketId)
    if (!existing || entry.confidence > existing.confidence) {
      bestByMarketId.set(entry.marketId, entry)
    }
  }

  return [...bestByMarketId.values()]
}

function pickDcricPair(detailPayload, parsedMarkets, fallbackEventName = '') {
  const eventPayload = asRecord(detailPayload.event)
  const eventMeta = asRecord(eventPayload.event)
  const eventName =
    asString(eventMeta.event_name) ||
    asString(eventMeta.name) ||
    asString(eventMeta.competition_name) ||
    asString(fallbackEventName)

  const parsedTeams = parseTeamsFromName(eventName)

  for (const market of parsedMarkets) {
    const activeRunners = market.runners.filter((runner) => runner.odds > 0)
    if (activeRunners.length !== 2) {
      continue
    }

    const [runnerA, runnerB] = activeRunners
    const teamA = asString(runnerA.name).trim() || asString(parsedTeams?.[0]).trim()
    const teamB = asString(runnerB.name).trim() || asString(parsedTeams?.[1]).trim()

    if (!teamA || !teamB || normalizeTeamName(teamA) === normalizeTeamName(teamB)) {
      continue
    }

    const probabilityA = parseDcricPriceProbability(runnerA.odds)
    const probabilityB = parseDcricPriceProbability(runnerB.odds)
    if (!probabilityA || !probabilityB) {
      continue
    }

    const pair = toPricePair(probabilityA, probabilityB)
    if (!pair) {
      continue
    }

    const secondaryMarkets = extractSecondaryMarkets(parsedMarkets)

    return {
      teamA,
      teamB,
      ...pair,
      provider: 'dcric99',
      secondaryMarkets,
    }
  }

  return null
}

async function fetchDcricEventDetail(eventId) {
  const safeEventId = String(eventId ?? '').trim()
  if (!safeEventId) {
    return null
  }

  const url = `${DCRIC99_EVENT_DETAIL_URL}/${encodeURIComponent(safeEventId)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const startTime = Date.now()

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'yesno-gateway-dcric99/1.0',
      },
      body: '{}',
    })

    const duration = Date.now() - startTime

    if (!response.ok) {
      logger.warn({ label: 'dcric99_event_detail', eventId: safeEventId, status: response.status, duration }, 'API returned non-OK status')
      return null
    }

    const payload = asRecord(await response.json().catch(() => null))
    logger.debug({ label: 'dcric99_event_detail', eventId: safeEventId, status: response.status, duration }, 'API call succeeded')
    return asRecord(payload.data)
  } catch (err) {
    const duration = Date.now() - startTime
    const isTimeout = err.name === 'AbortError'

    logger.error({
      label: 'dcric99_event_detail',
      eventId: safeEventId,
      error: err.message,
      isTimeout,
      duration
    }, isTimeout ? 'API call timed out' : 'API call failed')

    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchDcricOddsRows(baseUrl, marketIds) {
  if (marketIds.length === 0) {
    return []
  }

  const requestBody = marketIds
    .slice(0, 200)
    .map((marketId) => `market_ids[]=${encodeURIComponent(marketId)}`)
    .join('&')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const startTime = Date.now()

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/ws/getMarketDataNew`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'yesno-gateway-dcric99/1.0',
      },
      body: requestBody,
    })

    const duration = Date.now() - startTime

    if (!response.ok) {
      logger.warn({ label: 'dcric99_odds', marketCount: marketIds.length, status: response.status, duration }, 'API returned non-OK status')
      return []
    }

    const text = await response.text().catch(() => '')
    if (!text) {
      logger.warn({ label: 'dcric99_odds', marketCount: marketIds.length, duration }, 'API returned empty response')
      return []
    }

    const parsed = asArray(JSON.parse(text))
    logger.debug({ label: 'dcric99_odds', marketCount: marketIds.length, rowsReturned: parsed.length, duration }, 'API call succeeded')
    return parsed.map((row) => asString(row)).filter(Boolean)
  } catch (err) {
    const duration = Date.now() - startTime
    const isTimeout = err.name === 'AbortError'

    logger.error({
      label: 'dcric99_odds',
      marketCount: marketIds.length,
      error: err.message,
      isTimeout,
      duration
    }, isTimeout ? 'API call timed out' : 'API call failed')

    return []
  } finally {
    clearTimeout(timer)
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const safeLimit = Math.max(1, Math.floor(limit))
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1

      if (index >= items.length) {
        return
      }

      results[index] = await mapper(items[index], index).catch(() => null)
    }
  }

  const workers = Array.from({ length: Math.min(safeLimit, Math.max(1, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

async function fetchDcricPairFromEvent(eventEntry) {
  const eventId = String(eventEntry.event_id ?? eventEntry.id ?? '').trim()
  if (!eventId) {
    return null
  }

  const detailPayload = await fetchDcricEventDetail(eventId)
  const eventPayload = asRecord(detailPayload.event)
  if (Object.keys(eventPayload).length === 0) {
    return null
  }

  // Diagnostic: log eventPayload keys to discover fancy/session field names
  logger.debug(
    { eventId, keys: Object.keys(eventPayload), arrayKeys: Object.keys(eventPayload).filter((k) => Array.isArray(eventPayload[k])) },
    'dcric99 eventPayload structure',
  )

  const marketIds = buildDcricMarketIds(eventPayload)
  if (marketIds.length === 0) {
    return null
  }

  const oddsHub = asString(detailPayload.odds_hub).replace(/^https?:\/\//, '').trim()
  const oddsBaseUrl =
    Boolean(detailPayload.connect_odds_hub) && oddsHub
      ? `https://${oddsHub}`
      : DCRIC99_DEFAULT_ODDS_BASE_URL

  const rows = await fetchDcricOddsRows(oddsBaseUrl, marketIds)
  if (rows.length === 0) {
    return null
  }

  const parsedMarkets = parseDcricOddsRows(rows, detailPayload)
  if (parsedMarkets.length === 0) {
    return null
  }

  // Diagnostic: log parsed market names for classification tuning
  logger.debug(
    {
      eventId,
      totalParsedMarkets: parsedMarkets.length,
      marketNames: parsedMarkets.slice(0, 20).map((m) => ({ id: m.marketId, name: m.marketName, runners: m.runners.length })),
    },
    'dcric99 parsed markets for classification',
  )

  return pickDcricPair(
    detailPayload,
    parsedMarkets,
    asString(eventEntry.event_name, asString(eventEntry.name)),
  )
}

async function fetchDcric99Pairs(matches) {
  if (!DCRIC99_ENABLED) {
    return []
  }

  const eventListPayload = asRecord(await fetchJson(DCRIC99_EVENT_LIST_URL, 15_000, 'dcric99_event_list'))
  const eventRows = asArray(asRecord(eventListPayload.data).events)
    .map(asRecord)
    .filter((row) => asNumber(row.event_type_id, 0) === 4)

  if (eventRows.length === 0) {
    return []
  }

  const scoredEvents = eventRows
    .map((entry) => {
      const eventName = asString(entry.event_name, asString(entry.name))
      const hasMatchContext = matches.length > 0
      const hasNamedTeams = Boolean(parseTeamsFromName(eventName))
      const score = hasMatchContext
        ? scoreDcricEventCandidate(eventName, matches)
        : hasNamedTeams
          ? 1
          : 0.2

      return {
        entry,
        score,
        inPlay: asNumber(entry.in_play, 0),
        hasGoodScore: hasMatchContext ? score >= DCRIC99_MIN_SCORE : hasNamedTeams,
      }
    })
    .sort((left, right) => {
      if (right.hasGoodScore !== left.hasGoodScore) {
        return Number(right.hasGoodScore) - Number(left.hasGoodScore)
      }

      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (right.inPlay !== left.inPlay) {
        return right.inPlay - left.inPlay
      }

      return asString(left.entry.open_date).localeCompare(asString(right.entry.open_date))
    })

  const selectedEvents = scoredEvents
    .slice(0, DCRIC99_MAX_EVENT_DETAILS)
    .map((candidate) => candidate.entry)

  if (selectedEvents.length === 0) {
    return []
  }

  const maybePairs = await mapWithConcurrency(
    selectedEvents,
    DCRIC99_CONCURRENCY,
    async (entry) => fetchDcricPairFromEvent(entry),
  )

  const deduped = new Map()
  for (const pair of maybePairs.filter(Boolean)) {
    const directKey = `${normalizeTeamName(pair.teamA)}:${normalizeTeamName(pair.teamB)}`
    const reverseKey = `${normalizeTeamName(pair.teamB)}:${normalizeTeamName(pair.teamA)}`

    if (!deduped.has(directKey) && !deduped.has(reverseKey)) {
      deduped.set(directKey, pair)
    }
  }

  return [...deduped.values()]
}

function readPath(record, path) {
  if (!path) {
    return undefined
  }

  const parts = path.split('.').filter(Boolean)
  let current = record

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }

    current = current[part]
  }

  return current
}

function parseScraperPair(entry, providerName) {
  const homeTeam = String(entry.home ?? '').trim()
  const awayTeam = String(entry.away ?? '').trim()

  if (!homeTeam || !awayTeam) {
    return null
  }

  const homeProbability = parseOddsProbability(entry.homeOdds)
  const awayProbability = parseOddsProbability(entry.awayOdds)
  if (!homeProbability || !awayProbability) {
    return null
  }

  const pair = toPricePair(homeProbability, awayProbability)
  if (!pair) {
    return null
  }

  return {
    teamA: homeTeam,
    teamB: awayTeam,
    ...pair,
    provider: providerName,
  }
}

async function fetchScraperPairsFromSite(config) {
  const startTime = Date.now()

  const response = await fetch(config.url, {
    headers: {
      'user-agent': 'yesno-gateway-scraper/1.0',
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    },
  }).catch((err) => {
    logger.warn({ label: 'scraper', site: config.name, error: err.message }, 'Scraper fetch failed')
    return null
  })

  const duration = Date.now() - startTime

  if (!response) {
    return []
  }

  if (!response.ok) {
    logger.warn({ label: 'scraper', site: config.name, status: response.status, duration }, 'Scraper returned non-OK status')
    return []
  }

  if (config.format === 'json') {
    const payload = asRecord(await response.json().catch(() => ({})))
    const rows = asArray(readPath(payload, config.eventsPath))

    const pairs = rows
      .map((row) => {
        const event = asRecord(row)
        return parseScraperPair(
          {
            home: readPath(event, config.homeField),
            away: readPath(event, config.awayField),
            homeOdds: readPath(event, config.homeOddsField),
            awayOdds: readPath(event, config.awayOddsField),
          },
          config.name,
        )
      })
      .filter((pair) => pair !== null)

    logger.debug({ label: 'scraper', site: config.name, pairs: pairs.length, duration }, 'Scraper completed')
    return pairs
  }

  const html = await response.text().catch(() => '')
  if (!html) {
    logger.warn({ label: 'scraper', site: config.name, duration }, 'Scraper returned empty HTML')
    return []
  }

  const $ = loadHtml(html)
  const pairs = []

  $(config.eventSelector).each((_, element) => {
    const home = $(element).find(config.homeSelector).first().text().trim()
    const away = $(element).find(config.awaySelector).first().text().trim()
    const homeOdds = $(element).find(config.homeOddsSelector).first().text().trim()
    const awayOdds = $(element).find(config.awayOddsSelector).first().text().trim()

    const parsed = parseScraperPair({ home, away, homeOdds, awayOdds }, config.name)
    if (parsed) {
      pairs.push(parsed)
    }
  })

  logger.debug({ label: 'scraper', site: config.name, pairs: pairs.length, duration }, 'Scraper completed')
  return pairs
}

async function fetchScraperPairs() {
  if (scraperSiteConfigs.length === 0) {
    return []
  }

  const bySite = await Promise.all(scraperSiteConfigs.map((site) => fetchScraperPairsFromSite(site)))
  return bySite.flat()
}

async function fetchExternalOddsPairs(matches) {
  const [dcric99Pairs, theOddsPairs, scraperPairs] = await Promise.all([
    fetchDcric99Pairs(matches),
    fetchTheOddsPairs(),
    fetchScraperPairs(),
  ])
  return {
    pairs: [...dcric99Pairs, ...theOddsPairs, ...scraperPairs],
    counts: {
      dcric99: dcric99Pairs.length,
      theodds: theOddsPairs.length,
      scraper: scraperPairs.length,
    },
  }
}

function seededPrice(base, salt, min = 5, max = 95) {
  const jitter = ((hashToInt(`${salt}:${base}`) % 17) - 8) / 100
  const candidate = clamp(base / 100 + jitter, min / 100, max / 100)
  return clampPrice(candidate * 100)
}

function getLockedThreshold(matchId, marketId, incomingThreshold) {
  const key = `${matchId}:${marketId}`
  const existing = state.thresholdLockByMatchMarket.get(key)

  if (existing != null) {
    return existing
  }

  if (incomingThreshold != null && Number.isFinite(incomingThreshold)) {
    state.thresholdLockByMatchMarket.set(key, incomingThreshold)
    return incomingThreshold
  }

  return null
}

function buildMarketsForMatch(match) {
  const base = clampPrice(match.priceA)
  const inverse = clampPrice(100 - base)

  // Build lookup from external secondary market data (Dcric99 fancy/session/bookmaker)
  const ext = new Map()
  for (const em of match.externalMarkets ?? []) {
    ext.set(em.marketId, em)
  }

  // Helper: for over/under markets, lock the threshold once first seen
  const lockedThreshold = (marketId, defaultVal) => {
    const em = ext.get(marketId)
    return getLockedThreshold(match.id, marketId, em?.threshold) ?? defaultVal
  }

  // Helper: build options for an over/under market with external-data fallback
  const overUnderOptions = (marketId, defaultThreshold, baseBias, salt) => {
    const em = ext.get(marketId)
    const threshold = lockedThreshold(marketId, defaultThreshold)

    if (em) {
      // Use external prices but apply the locked threshold to labels
      return [
        { label: `Over ${threshold}`, price: clampPrice(em.priceA), type: 'green' },
        { label: `Under ${threshold}`, price: clampPrice(em.priceB), type: 'red' },
      ]
    }

    // Fallback: seeded prices with default threshold
    return [
      { label: `Over ${threshold}`, price: seededPrice(base + baseBias, `${match.id}:${salt}:o`), type: 'green' },
      { label: `Under ${threshold}`, price: seededPrice(inverse + baseBias, `${match.id}:${salt}:u`), type: 'red' },
    ]
  }

  // Market 2: Toss Winner
  const m2 = ext.get(2)
  const tossOptions = m2
    ? [
        { label: m2.labelA, price: clampPrice(m2.priceA), type: 'green' },
        { label: m2.labelB, price: clampPrice(m2.priceB), type: 'blue' },
      ]
    : [
        { label: match.teamA, price: seededPrice(base, `${match.id}:toss:a`, 40, 60), type: 'green' },
        { label: match.teamB, price: seededPrice(inverse, `${match.id}:toss:b`, 40, 60), type: 'blue' },
      ]

  // Market 5: Top Batter 30+
  const m5 = ext.get(5)
  const batterOptions = m5
    ? [
        { label: m5.labelA, price: clampPrice(m5.priceA), type: 'green' },
        { label: m5.labelB, price: clampPrice(m5.priceB), type: 'red' },
      ]
    : [
        { label: 'Yes', price: seededPrice(base + 8, `${match.id}:bat:yes`), type: 'green' },
        { label: 'No', price: seededPrice(inverse + 8, `${match.id}:bat:no`), type: 'red' },
      ]

  // Market 8: Odd/Even
  const m8 = ext.get(8)
  const oddEvenOptions = m8
    ? [
        { label: m8.labelA, price: clampPrice(m8.priceA), type: 'green' },
        { label: m8.labelB, price: clampPrice(m8.priceB), type: 'blue' },
      ]
    : [
        { label: 'Odd', price: seededPrice(base, `${match.id}:oe:odd`, 45, 55), type: 'green' },
        { label: 'Even', price: seededPrice(inverse, `${match.id}:oe:even`, 45, 55), type: 'blue' },
      ]

  return [
    {
      id: 1,
      category: 'winner',
      title: 'Match Winner',
      volume: match.volume,
      live: match.isLive,
      options: [
        { label: match.teamA, price: base, type: 'green' },
        { label: match.teamB, price: inverse, type: 'blue' },
      ],
    },
    {
      id: 2,
      category: 'winner',
      title: 'Toss Winner',
      volume: '620K',
      options: tossOptions,
    },
    {
      id: 3,
      category: 'sessions',
      title: `Powerplay Runs - ${match.teamA}`,
      volume: '1.4L',
      live: match.isLive,
      options: overUnderOptions(3, 48.5, 5, 'pp'),
    },
    {
      id: 4,
      category: 'sessions',
      title: `10 Over Runs - ${match.teamA}`,
      volume: '1.9L',
      live: match.isLive,
      options: overUnderOptions(4, 82.5, 3, '10'),
    },
    {
      id: 5,
      category: 'player',
      title: `${match.teamA} Top Batter 30+`,
      volume: '980K',
      options: batterOptions,
    },
    {
      id: 6,
      category: 'wickets',
      title: `Total Wickets - ${match.teamA}`,
      volume: '860K',
      live: match.isLive,
      options: overUnderOptions(6, 6.5, 2, 'wk'),
    },
    {
      id: 7,
      category: 'overbyover',
      title: `Over 20 Runs - ${match.teamA}`,
      volume: '740K',
      live: match.isLive,
      options: overUnderOptions(7, 10.5, 1, 'ov20'),
    },
    {
      id: 8,
      category: 'oddeven',
      title: 'Match Total - Odd or Even?',
      volume: '510K',
      options: oddEvenOptions,
    },
  ]
}

function marketKey(matchId, marketId, optionLabel, side) {
  return `${matchId}:${marketId}:${normalizeTeamName(optionLabel)}:${side}`
}

function appendHistoryPoint(key, price) {
  const existing = state.historyByMarketKey.get(key) ?? []
  const point = { at: nowIso(), price }
  const next = [...existing, point]

  if (next.length > MARKET_HISTORY_LIMIT) {
    next.splice(0, next.length - MARKET_HISTORY_LIMIT)
  }

  state.historyByMarketKey.set(key, next)

  return { market_key: key, price, recorded_at: point.at }
}

function appendMarketHistory(match, markets) {
  const rows = []
  for (const market of markets) {
    for (const option of market.options) {
      const yesKey = marketKey(match.id, market.id, option.label, 'yes')
      rows.push(appendHistoryPoint(yesKey, option.price))

      const noKey = marketKey(match.id, market.id, option.label, 'no')
      rows.push(appendHistoryPoint(noKey, clampPrice(100 - option.price)))
    }
  }

  // Persist to Supabase (fire-and-forget for performance)
  if (supabaseAdmin && rows.length > 0) {
    supabaseAdmin.from('server_price_history').insert(rows).then(({ error }) => {
      if (error) logger.warn({ error, count: rows.length }, 'Failed to persist price history')
    })
  }
}

function trimAuditLogs() {
  if (state.audits.length > 1000) {
    state.audits.splice(0, state.audits.length - 1000)
  }
}

function appendAudit(type, details) {
  state.audits.push({
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    at: nowIso(),
    type,
    details,
  })

  trimAuditLogs()
}

/**
 * Create a fresh user object with default values.
 */
function createDefaultUser(safeUserId) {
  return {
    userId: safeUserId,
    balance: STARTING_BALANCE,
    heldBalance: 0,
    suspended: false,
    name: null,
    email: null,
    kycStatus: 'pending',
    kycPan: null,
    kycAadhaar: null,
    kycBankAccount: null,
    kycIfsc: null,
    kycHolderName: null,
    settings: { notifications: true, sounds: true, biometric: false },
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
  }
}

/**
 * Populate user object from Supabase row data.
 */
function populateUserFromDb(user, data) {
  user.balance = data.balance ?? STARTING_BALANCE
  user.name = data.name ?? null
  user.email = data.email ?? null
  user.kycStatus = data.kyc_status ?? 'pending'
  user.kycPan = data.kyc_pan ?? null
  user.kycAadhaar = data.kyc_aadhaar ?? null
  user.kycBankAccount = data.kyc_bank_account ?? null
  user.kycIfsc = data.kyc_ifsc ?? null
  user.kycHolderName = data.kyc_holder_name ?? null
  user.settings = data.settings ?? { notifications: true, sounds: true, biometric: false }
}

/**
 * Async version that properly awaits Supabase load.
 * Use this in endpoints that need fresh data from DB (like portfolio).
 */
async function ensureUserAsync(userId) {
  const safeUserId = String(userId || 'guest').trim() || 'guest'
  let user = state.users.get(safeUserId)
  let isNewUser = false

  if (!user) {
    user = createDefaultUser(safeUserId)
    state.users.set(safeUserId, user)
    state.positionsByUser.set(safeUserId, [])
    isNewUser = true
  }

  // Only load from Supabase for NEW users (first time seen in memory)
  // This prevents race conditions where DB reload overwrites in-flight balance changes
  if (supabaseAdmin && isNewUser) {
    try {
      const { data, error } = await supabaseAdmin
        .from('server_wallets')
        .select('*')
        .eq('user_id', safeUserId)
        .maybeSingle()

      if (error) {
        logger.error({ err: error, userId: safeUserId }, 'Failed to load user from Supabase')
      } else if (data) {
        // Existing user in DB - restore their data
        populateUserFromDb(user, data)
        logger.info({ userId: safeUserId, balance: user.balance }, 'User data loaded from Supabase')
      } else {
        // New user - create in Supabase (upsert to handle race conditions)
        const { error: upsertError } = await supabaseAdmin
          .from('server_wallets')
          .upsert({
            user_id: safeUserId,
            balance: STARTING_BALANCE,
            bonus_balance: 0,
            held_balance: 0,
            kyc_status: 'pending',
            settings: { notifications: true, sounds: true, biometric: false },
            updated_at: nowIso(),
          }, { onConflict: 'user_id', ignoreDuplicates: true })

        if (upsertError) {
          logger.error({ err: upsertError, userId: safeUserId }, 'Failed to upsert new user wallet to Supabase')
        } else {
          logger.info({ userId: safeUserId }, 'New user wallet created in Supabase')
        }
      }
    } catch (err) {
      logger.error({ err, userId: safeUserId }, 'Failed to check user in Supabase')
    }
  }

  user.lastSeenAt = nowIso()
  return user
}

/**
 * Sync version for places where we don't need to wait for DB.
 * Note: This may return stale data. Use ensureUserAsync for authoritative data.
 */
function ensureUser(userId) {
  const safeUserId = String(userId || 'guest').trim() || 'guest'
  let user = state.users.get(safeUserId)

  if (!user) {
    user = createDefaultUser(safeUserId)
    state.users.set(safeUserId, user)
    state.positionsByUser.set(safeUserId, [])

    // Fire-and-forget load from Supabase (for background sync)
    if (supabaseAdmin) {
      supabaseAdmin
        .from('server_wallets')
        .select('*')
        .eq('user_id', safeUserId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) {
            logger.error({ err: error, userId: safeUserId }, 'Failed to load user from Supabase')
            return
          }

          if (data) {
            populateUserFromDb(user, data)
            logger.info({ userId: safeUserId }, 'User profile restored from Supabase (async)')
          } else {
            supabaseAdmin
              .from('server_wallets')
              .upsert({
                user_id: safeUserId,
                balance: STARTING_BALANCE,
                bonus_balance: 0,
                held_balance: 0,
                kyc_status: 'pending',
                settings: { notifications: true, sounds: true, biometric: false },
                updated_at: nowIso(),
              }, { onConflict: 'user_id', ignoreDuplicates: true })
              .then(({ error }) => {
                if (error) {
                  logger.error({ err: error, userId: safeUserId }, 'Failed to upsert new user wallet to Supabase')
                } else {
                  logger.info({ userId: safeUserId }, 'New user wallet created in Supabase')
                }
              })
          }
        })
        .catch((err) => logger.error({ err, userId: safeUserId }, 'Failed to check user in Supabase'))
    }
  }

  user.lastSeenAt = nowIso()
  return user
}

function getUserPositions(userId) {
  return state.positionsByUser.get(userId) ?? []
}

function getUserOpenExposure(userId) {
  return getUserPositions(userId)
    .filter((position) => position.status === 'open')
    .reduce((total, position) => total + position.stakeRemaining, 0)
}

function getMatchOpenExposure(matchId) {
  let total = 0

  for (const positions of state.positionsByUser.values()) {
    for (const position of positions) {
      if (position.matchId === matchId && position.status === 'open') {
        total += position.stakeRemaining
      }
    }
  }

  return total
}

function findMarketOption(matchId, marketId, optionLabel) {
  const markets = state.marketsByMatch.get(matchId) ?? []
  const market = markets.find((entry) => entry.id === marketId)
  if (!market) {
    return null
  }

  const normalizedOption = normalizeTeamName(optionLabel)
  const option =
    market.options.find((entry) => normalizeTeamName(entry.label) === normalizedOption) ??
    market.options.find((entry) => tokenOverlap(entry.label, optionLabel) >= 0.7)

  if (!option) {
    return null
  }

  return {
    market,
    option,
  }
}

function inferWinnerForMatch(match) {
  const explicit = detectWinnerFromStatus(match.statusText, match.teamAFull, match.teamBFull)
  if (explicit === 'A') {
    return { winnerCode: match.teamA, winnerFull: match.teamAFull }
  }

  if (explicit === 'B') {
    return { winnerCode: match.teamB, winnerFull: match.teamBFull }
  }

  return null
}

function optionRepresentsWinner(optionLabel, match, winner) {
  const normalizedOption = normalizeTeamName(optionLabel)

  const optionIsA =
    tokenOverlap(normalizedOption, normalizeTeamName(match.teamA)) > 0.6 ||
    tokenOverlap(normalizedOption, normalizeTeamName(match.teamAFull)) > 0.5

  const optionIsB =
    tokenOverlap(normalizedOption, normalizeTeamName(match.teamB)) > 0.6 ||
    tokenOverlap(normalizedOption, normalizeTeamName(match.teamBFull)) > 0.5

  if (!optionIsA && !optionIsB) {
    return null
  }

  if (winner.winnerCode === match.teamA) {
    return optionIsA
  }

  if (winner.winnerCode === match.teamB) {
    return optionIsB
  }

  return null
}

// ============================================================
// Market resolution functions
// ============================================================

function resolveMarket1(position, match, winner) {
  const winnerSide = optionRepresentsWinner(position.optionLabel, match, winner)
  if (winnerSide === null) {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }
  const didWin = position.side === 'yes' ? winnerSide : !winnerSide
  return {
    payout: didWin ? position.sharesRemaining : 0,
    outcome: didWin ? 'win' : 'lose',
  }
}

function resolveMarket6(position, match) {
  const { scoreA } = parseMatchScoreState(match)

  if (!scoreA.hasScore) {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }

  const parsed = parseThresholdFromLabel(position.optionLabel)
  if (!parsed) {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }

  const actualWickets = scoreA.wickets
  const { direction, threshold } = parsed

  // Safety: exact match on half-integer thresholds is impossible with integer wickets
  if (actualWickets === threshold) {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }

  const optionIsTrue = direction === 'over'
    ? actualWickets > threshold
    : actualWickets < threshold

  const didWin = position.side === 'yes' ? optionIsTrue : !optionIsTrue
  return {
    payout: didWin ? position.sharesRemaining : 0,
    outcome: didWin ? 'win' : 'lose',
  }
}

function resolveMarket8(position, match) {
  const { scoreA, scoreB } = parseMatchScoreState(match)

  if (!scoreA.hasScore || !scoreB.hasScore) {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }

  const matchTotal = scoreA.runs + scoreB.runs
  const isOdd = matchTotal % 2 !== 0

  const optionLabelLower = String(position.optionLabel ?? '').toLowerCase().trim()

  let optionIsTrue
  if (optionLabelLower === 'odd') {
    optionIsTrue = isOdd
  } else if (optionLabelLower === 'even') {
    optionIsTrue = !isOdd
  } else {
    return { payout: position.stakeRemaining, outcome: 'void' }
  }

  const didWin = position.side === 'yes' ? optionIsTrue : !optionIsTrue
  return {
    payout: didWin ? position.sharesRemaining : 0,
    outcome: didWin ? 'win' : 'lose',
  }
}

function settleMatch(matchId, winnerLabel, actor = 'system') {
  const match = state.matches.find((entry) => entry.id === matchId)
  if (!match) {
    return { ok: false, error: 'Match not found' }
  }

  if (state.settlementsByMatch.has(matchId)) {
    return { ok: false, error: 'Match already settled' }
  }

  let winner = null
  if (winnerLabel) {
    const normalizedWinner = normalizeTeamName(winnerLabel)
    const isA =
      tokenOverlap(normalizedWinner, match.teamAFull) >= 0.5 ||
      tokenOverlap(normalizedWinner, match.teamA) >= 0.7
    const isB =
      tokenOverlap(normalizedWinner, match.teamBFull) >= 0.5 ||
      tokenOverlap(normalizedWinner, match.teamB) >= 0.7

    if (isA) {
      winner = { winnerCode: match.teamA, winnerFull: match.teamAFull }
    } else if (isB) {
      winner = { winnerCode: match.teamB, winnerFull: match.teamBFull }
    }
  }

  if (!winner) {
    winner = inferWinnerForMatch(match)
  }

  if (!winner) {
    return { ok: false, error: 'Could not infer match winner yet' }
  }

  const settlementRows = []

  for (const [userId, positions] of state.positionsByUser.entries()) {
    const user = ensureUser(userId)

    for (const position of positions) {
      if (position.matchId !== matchId || position.status !== 'open') {
        continue
      }

      let payout = 0
      let outcome = 'void'

      if (position.marketId === 1) {
        const result = resolveMarket1(position, match, winner)
        payout = result.payout
        outcome = result.outcome
      } else if (position.marketId === 6) {
        const result = resolveMarket6(position, match)
        payout = result.payout
        outcome = result.outcome
      } else if (position.marketId === 8) {
        const result = resolveMarket8(position, match)
        payout = result.payout
        outcome = result.outcome
      } else {
        // Markets 2, 3, 4, 5, 7: No data available from API — void (refund stake)
        payout = position.stakeRemaining
        outcome = 'void'
      }

      user.balance += payout
      position.status = 'settled'
      position.settledAt = nowIso()
      position.outcome = outcome
      position.payout = payout
      position.stakeRemaining = 0
      position.sharesRemaining = 0

      settlementRows.push({
        userId,
        positionId: position.id,
        payout,
        outcome,
      })
    }
  }

  const settlement = {
    matchId,
    winnerCode: winner.winnerCode,
    winnerFull: winner.winnerFull,
    settledAt: nowIso(),
    settledBy: actor,
    rows: settlementRows,
  }

  state.settlementsByMatch.set(matchId, settlement)

  // Clean up threshold locks for the settled match
  for (let mId = 2; mId <= 8; mId++) {
    state.thresholdLockByMatchMarket.delete(`${matchId}:${mId}`)
  }

  // Persist settlement to Supabase (async, non-blocking)
  if (supabaseAdmin) {
    const dbOperations = []

    // Insert settlement record
    dbOperations.push(
      supabaseAdmin.from('match_settlements').insert({
        match_id: matchId,
        winner_code: winner.winnerCode,
        winner_full: winner.winnerFull,
        settled_by: actor,
      })
    )

    // Update all affected positions and wallet balances
    for (const [userId, positions] of state.positionsByUser.entries()) {
      for (const position of positions) {
        if (position.matchId === matchId && position.status === 'settled') {
          // Update position with settlement outcome (using server_positions)
          dbOperations.push(
            supabaseAdmin
              .from('server_positions')
              .update({
                status: 'settled',
                outcome: position.outcome,
                payout: position.payout,
                settled_at: position.settledAt,
              })
              .eq('user_id', userId)
              .eq('match_id', matchId)
              .eq('option_label', position.optionLabel)
              .eq('side', position.side)
              .eq('status', 'open')
          )

          // Insert wallet transaction for payout (using server_wallet_transactions)
          if (position.payout && position.payout > 0) {
            dbOperations.push(
              supabaseAdmin.from('server_wallet_transactions').insert({
                user_id: userId,
                type: 'credit',
                amount: position.payout,
                description: `Settlement: ${position.matchLabel} - ${position.outcome === 'win' ? 'Won' : position.outcome === 'void' ? 'Refunded' : 'Lost'}`,
                icon: position.outcome === 'win' ? '🎉' : position.outcome === 'void' ? '↩️' : '📉',
              })
            )
          }
        }
      }

      // Update wallet balance for this user (using server_wallets)
      const user = state.users.get(userId)
      if (user) {
        dbOperations.push(
          supabaseAdmin
            .from('server_wallets')
            .update({ balance: user.balance })
            .eq('user_id', userId)
        )
      }
    }

    // Insert admin audit
    dbOperations.push(
      supabaseAdmin.from('admin_audits').insert({
        action: 'match_settled',
        admin_id: actor,
        target_id: String(matchId),
        details: {
          winner: winner.winnerFull,
          settledPositions: settlementRows.length,
        },
      })
    )

    Promise.all(dbOperations).catch((err) => {
      logger.error({ err, matchId, actor }, 'Failed to persist settlement to Supabase')
    })
  }

  // Socket.io: push settlement notifications to affected users
  if (io) {
    const affectedUserIds = new Set(settlementRows.map((row) => row.userId))
    for (const affectedUserId of affectedUserIds) {
      const affectedUser = state.users.get(affectedUserId)
      const userRows = settlementRows.filter((row) => row.userId === affectedUserId)
      io.to(`user:${affectedUserId}`).emit('position:settled', {
        matchId,
        winnerCode: winner.winnerCode,
        winnerFull: winner.winnerFull,
        settledBy: actor,
        positions: userRows,
        balance: affectedUser?.balance ?? 0,
      })
      io.to(`user:${affectedUserId}`).emit('portfolio:update', {
        balance: affectedUser?.balance ?? 0,
        positions: getUserPositions(affectedUserId),
        exposure: getUserOpenExposure(affectedUserId),
      })
    }
  }

  appendAudit('match_settled', {
    actor,
    matchId,
    winner: winner.winnerFull,
    settledPositions: settlementRows.length,
  })

  return { ok: true, settlement }
}

function autoSettleResolvedMatches() {
  for (const match of state.matches) {
    if (state.settlementsByMatch.has(match.id)) {
      continue
    }

    if (!String(match.statusText ?? '').toLowerCase().includes('won')) {
      continue
    }

    settleMatch(match.id, null, 'auto')
  }
}

function buildAdminOverview() {
  const matches = state.matches.map((match) => {
    const marketStatus =
      state.marketStatusByMatch.get(match.id) ?? {
        suspended: false,
        reason: '',
        updatedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : nowIso(),
      }

    return {
      id: match.id,
      label: `${match.teamA} vs ${match.teamB}`,
      category: match.category,
      isLive: match.isLive,
      statusText: match.statusText,
      priceA: match.priceA,
      priceB: match.priceB,
      tradingStatus: marketStatus.suspended ? 'suspended' : 'open',
      reason: marketStatus.reason,
      matchExposure: getMatchOpenExposure(match.id),
      settled: state.settlementsByMatch.has(match.id),
    }
  })

  const users = [...state.users.values()].map((user) => ({
    userId: user.userId,
    balance: user.balance,
    suspended: user.suspended,
    exposure: getUserOpenExposure(user.userId),
    openPositions: getUserPositions(user.userId).filter((position) => position.status === 'open').length,
    lastSeenAt: user.lastSeenAt,
  }))

  return {
    fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    stale: Date.now() - state.fetchedAt > STALE_AFTER_MS,
    feedSource: state.feedSource,
    matches,
    users,
    totals: {
      openPositions: [...state.positionsByUser.values()].reduce(
        (count, positions) => count + positions.filter((position) => position.status === 'open').length,
        0,
      ),
      settledMatches: state.settlementsByMatch.size,
      audits: state.audits.length,
    },
    audits: state.audits.slice(-200).reverse(),
  }
}

async function refreshGateway() {
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const refreshStartTime = Date.now()

    if (!CRICKETDATA_API_KEY) {
      state.stale = true
      state.feedSource = 'missing_cricket_api_key'
      logger.warn({ feedSource: 'missing_cricket_api_key' }, 'Gateway refresh skipped - no CricAPI key')
      return
    }

    const cricketMatches = await fetchCricketMatches()
    const oddsResult = await fetchExternalOddsPairs(cricketMatches)
    const oddsPairs = oddsResult.pairs
    const oddsCounts = oddsResult.counts
    const matches =
      cricketMatches.length > 0 ? cricketMatches : buildSyntheticMatchesFromOddsPairs(oddsPairs)
    const { pricedMatches, feedSource } = applyPricing(matches, oddsPairs)
    const sortedMatches = pricedMatches.sort((left, right) => Number(right.isLive) - Number(left.isLive))

    if (sortedMatches.length === 0) {
      const duration = Date.now() - refreshStartTime

      if (state.matches.length > 0) {
        state.stale = true
        state.feedSource = `${feedSource}_cache`
        logger.warn({ feedSource: `${feedSource}_cache`, matchCount: 0, stale: true, oddsSources: oddsCounts, duration }, 'Gateway refresh empty - using cache')
        appendAudit('gateway_refresh_empty_kept_cache', {
          previousMatches: state.matches.length,
          oddsSources: oddsCounts,
        })
        return
      }

      state.matches = []
      state.fetchedAt = Date.now()
      state.stale = true
      state.feedSource = `${feedSource}_empty`
      logger.warn({ feedSource: `${feedSource}_empty`, matchCount: 0, stale: true, oddsSources: oddsCounts, duration }, 'Gateway refresh empty - no cache')
      return
    }

    state.matches = sortedMatches
    state.fetchedAt = Date.now()
    state.stale = false
    state.feedSource = feedSource

    const nextMarketsByMatch = new Map()

    for (const match of sortedMatches) {
      const markets = buildMarketsForMatch(match)
      nextMarketsByMatch.set(match.id, markets)
      appendMarketHistory(match, markets)

      if (!state.marketStatusByMatch.has(match.id)) {
        state.marketStatusByMatch.set(match.id, {
          suspended: false,
          reason: '',
          updatedAt: nowIso(),
        })
      }
    }

    state.marketsByMatch = nextMarketsByMatch

    // Socket.io: push real-time updates to connected clients
    if (io) {
      io.emit('matches:update', { matches: sortedMatches })

      for (const [matchId, markets] of nextMarketsByMatch.entries()) {
        const tradingStatus = state.marketStatusByMatch.get(matchId) ?? { suspended: false, reason: '' }
        io.to(`match:${matchId}`).emit('markets:update', { matchId, markets, tradingStatus })
      }

      io.to('admin').emit('admin:overview', { overview: buildAdminOverview() })
    }

    const duration = Date.now() - refreshStartTime
    logger.info({
      feedSource,
      matchCount: sortedMatches.length,
      stale: false,
      oddsSources: oddsCounts,
      duration,
    }, 'Gateway refresh completed')

    appendAudit('gateway_refresh', {
      feedSource,
      matchCount: sortedMatches.length,
      oddsSources: oddsCounts,
    })

    autoSettleResolvedMatches()
  })()
    .catch((error) => {
      state.stale = true
      appendAudit('gateway_refresh_failed', {
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

function requireAdmin(req, res, next) {
  const providedKey = req.header('x-admin-key')

  if (!providedKey || providedKey !== ADMIN_API_KEY) {
    res.status(401).json({
      ok: false,
      error: 'Unauthorized admin request',
      code: 'ADMIN_UNAUTHORIZED',
    })
    return
  }

  next()
}

async function requireAuth(req, res, next) {
  // Test mode fallback: if DISABLE_AUTH_FOR_TESTING=true, use hardcoded user ID
  if (DISABLE_AUTH_FOR_TESTING) {
    req.authenticatedUserId = String(req.body?.userId ?? req.query?.userId ?? 'user-123').trim() || 'user-123'
    return next()
  }

  // Dev fallback: if no Supabase configured, use userId from body/query (backward compat)
  if (!supabaseAdmin) {
    req.authenticatedUserId = String(req.body?.userId ?? req.query?.userId ?? 'guest').trim() || 'guest'
    return next()
  }

  const authHeader = req.header('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing authorization token', code: 'AUTH_REQUIRED' })
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token', code: 'AUTH_INVALID' })
    }
    req.authenticatedUserId = user.id
    next()
  } catch (err) {
    logger.error({ err }, 'Auth verification failed')
    return res.status(401).json({ ok: false, error: 'Authentication failed', code: 'AUTH_ERROR' })
  }
}

const app = express()

// Railway runs behind a reverse proxy — trust it for correct client IPs in rate limiting
app.set('trust proxy', 1)

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  next()
})

// CORS — restricted in production via ALLOWED_ORIGINS env var, open in dev
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : null

app.use(
  cors(
    ALLOWED_ORIGINS
      ? { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }
      : undefined,
  ),
)
app.use(express.json({ limit: '1mb' }))
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/healthz' } }))

const tradeLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
})
app.use('/api/trades', tradeLimiter)
app.use('/api/withdrawals', tradeLimiter)

if (SERVE_FRONTEND && fs.existsSync(FRONTEND_INDEX_FILE)) {
  // Hashed assets (immutable) — cache for 1 year
  app.use(
    '/assets',
    express.static(path.join(FRONTEND_DIST_DIR, 'assets'), {
      index: false,
      maxAge: '365d',
      immutable: true,
    }),
  )
  // Other static files (favicon etc.) — cache for 5 minutes
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: false,
      maxAge: '5m',
    }),
  )
}

// Liveness probe for Railway health checks
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() })
})

app.get('/api/health', async (_req, res) => {
  if (Date.now() - state.fetchedAt > POLL_INTERVAL_MS) {
    await refreshGateway()
  }

  res.json({
    ok: true,
    now: nowIso(),
    feedSource: state.feedSource,
    stale: Date.now() - state.fetchedAt > STALE_AFTER_MS,
    fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    hasCricketApiKey: Boolean(CRICKETDATA_API_KEY),
    hasExternalOddsProviders:
      DCRIC99_ENABLED || Boolean(ODDS_API_KEY) || scraperSiteConfigs.length > 0,
  })
})

app.get('/api/live/matches', async (_req, res) => {
  if (Date.now() - state.fetchedAt > POLL_INTERVAL_MS) {
    await refreshGateway()
  }

  // Inject sparkline data (last 20 price points for winner market teamA YES)
  const matchesWithSparkline = state.matches.map((match) => {
    const key = marketKey(match.id, 1, match.teamA, 'yes')
    const history = state.historyByMarketKey.get(key)
    if (history && history.length >= 2) {
      const sparkline = history.slice(-20).map((pt) => Math.round(pt.price))
      return { ...match, sparkline }
    }
    return match
  })

  res.json({
    ok: true,
    fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    stale: Date.now() - state.fetchedAt > STALE_AFTER_MS,
    feedSource: state.feedSource,
    matches: matchesWithSparkline,
  })
})

// ── Trade Tape (recent trades per match) ────────────────────
app.get('/api/live/trades/:matchId', async (req, res) => {
  const matchId = Number(req.params.matchId)
  if (!Number.isFinite(matchId)) {
    return res.status(400).json({ ok: false, error: 'Invalid match id' })
  }

  const trades = state.orders
    .filter((order) => order.matchId === matchId)
    .slice(0, 20)
    .map((order) => ({
      id: order.id,
      side: order.side,
      optionLabel: order.optionLabel,
      amount: order.amount,
      price: order.price,
      at: order.at,
    }))

  res.json({ ok: true, trades })
})

app.get('/api/live/markets/:matchId', async (req, res) => {
  const matchId = Number(req.params.matchId)

  if (!Number.isFinite(matchId)) {
    res.status(400).json({ ok: false, error: 'Invalid match id' })
    return
  }

  if (Date.now() - state.fetchedAt > POLL_INTERVAL_MS) {
    await refreshGateway()
  }

  const match = state.matches.find((entry) => entry.id === matchId)
  if (!match) {
    res.status(404).json({ ok: false, error: 'Match not found' })
    return
  }

  const tradingStatus =
    state.marketStatusByMatch.get(matchId) ?? {
      suspended: false,
      reason: '',
      updatedAt: nowIso(),
    }

  res.json({
    ok: true,
    fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    stale: Date.now() - state.fetchedAt > STALE_AFTER_MS,
    feedSource: state.feedSource,
    tradingStatus,
    match,
    markets: state.marketsByMatch.get(matchId) ?? [],
  })
})

app.get('/api/live/history', async (req, res) => {
  const matchId = Number(req.query.matchId)
  const marketId = Number(req.query.marketId)
  const optionLabel = String(req.query.optionLabel ?? '').trim()
  const side = String(req.query.side ?? 'yes').toLowerCase() === 'no' ? 'no' : 'yes'
  const rangeMinutes = clamp(Number(req.query.rangeMinutes ?? 60), 5, 24 * 60)

  if (!Number.isFinite(matchId) || !Number.isFinite(marketId) || !optionLabel) {
    res.status(400).json({ ok: false, error: 'matchId, marketId, and optionLabel are required' })
    return
  }

  const key = marketKey(matchId, marketId, optionLabel, side)
  const history = state.historyByMarketKey.get(key) ?? []
  const startAt = Date.now() - rangeMinutes * 60_000

  res.json({
    ok: true,
    key,
    rangeMinutes,
    points: history.filter((point) => Date.parse(point.at) >= startAt),
  })
})

app.get('/api/trades/portfolio', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId

  // Use async version to properly await Supabase load
  const user = await ensureUserAsync(userId)
  let transactions = []

  // Fetch transactions from Supabase
  if (supabaseAdmin) {
    try {
      const { data: txns, error: txnError } = await supabaseAdmin
        .from('server_wallet_transactions')
        .select('id, type, amount, description, icon, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!txnError && txns) {
        transactions = txns.map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          icon: t.icon,
          timestamp: t.created_at,
        }))
      }
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch transactions from Supabase')
    }
  }

  res.json({
    ok: true,
    user: {
      userId: user.userId,
      balance: user.balance,
      name: user.name,
      email: user.email,
      kycStatus: user.kycStatus,
      kycPan: user.kycPan,
      kycAadhaar: user.kycAadhaar,
      kycBankAccount: user.kycBankAccount,
      kycIfsc: user.kycIfsc,
      kycHolderName: user.kycHolderName,
      settings: user.settings,
      suspended: user.suspended,
      exposure: getUserOpenExposure(user.userId),
    },
    positions: getUserPositions(user.userId),
    transactions,
  })
})

// ── Profile Update ─────────────────────────────────────────────
app.post('/api/user/profile', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId
  const { name, email, settings } = asRecord(req.body)

  // Use async version to get fresh user data first
  const user = await ensureUserAsync(userId)
  if (name !== undefined) user.name = name
  if (email !== undefined) user.email = email
  if (settings !== undefined) user.settings = settings

  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('server_wallets')
        .upsert({
          user_id: userId,
          balance: user.balance,
          name: user.name,
          email: user.email,
          settings: user.settings,
          kyc_status: user.kycStatus,
          updated_at: nowIso(),
        }, { onConflict: 'user_id' })
      logger.info({ userId }, 'User profile updated in Supabase')
    } catch (err) {
      logger.error({ err, userId }, 'Failed to persist profile to Supabase')
    }
  }

  res.json({ ok: true })
})

// ── KYC Update ─────────────────────────────────────────────
app.post('/api/user/kyc', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId
  const { pan, aadhaar, bankAccount, ifsc, holderName, status } = asRecord(req.body)

  // Use async version to get fresh user data first
  const user = await ensureUserAsync(userId)
  if (pan) user.kycPan = pan
  if (aadhaar) user.kycAadhaar = aadhaar
  if (bankAccount) user.kycBankAccount = bankAccount
  if (ifsc) user.kycIfsc = ifsc
  if (holderName) user.kycHolderName = holderName
  if (status) user.kycStatus = status

  if (supabaseAdmin) {
    try {
      await supabaseAdmin
        .from('server_wallets')
        .upsert({
          user_id: userId,
          balance: user.balance,
          kyc_status: user.kycStatus,
          kyc_pan: user.kycPan,
          kyc_aadhaar: user.kycAadhaar,
          kyc_bank_account: user.kycBankAccount,
          kyc_ifsc: user.kycIfsc,
          kyc_holder_name: user.kycHolderName,
          updated_at: nowIso(),
        }, { onConflict: 'user_id' })
      logger.info({ userId }, 'User KYC updated in Supabase')
    } catch (err) {
      logger.error({ err, userId }, 'Failed to persist KYC to Supabase')
    }
  }

  res.json({ ok: true })
})

// ── Leaderboard ─────────────────────────────────────────────
function anonymizeUserId(userId) {
  if (!userId || userId.length < 8) return userId
  return userId.slice(0, 4) + '****' + userId.slice(-4)
}

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  const currentUserId = req.authenticatedUserId
  const entries = []

  for (const [userId, positions] of state.positionsByUser.entries()) {
    const settled = positions.filter((p) => p.status === 'settled')
    if (settled.length === 0) continue

    const wins = settled.filter((p) => p.outcome === 'win')
    const losses = settled.filter((p) => p.outcome === 'lose')
    const decidedCount = wins.length + losses.length

    let totalPnl = 0
    for (const p of settled) {
      if (p.outcome === 'win') totalPnl += (p.payout ?? 0) - (p.stake ?? 0)
      else if (p.outcome === 'lose') totalPnl -= p.stake ?? 0
    }

    const winRate = decidedCount > 0 ? (wins.length / decidedCount) * 100 : 0

    entries.push({
      userId,
      totalPnl,
      winRate: Math.round(winRate * 10) / 10,
      tradesCount: settled.length,
    })
  }

  entries.sort((a, b) => b.totalPnl - a.totalPnl)

  const leaderboard = entries.slice(0, 50).map((entry, index) => ({
    rank: index + 1,
    userId: entry.userId,
    displayName: anonymizeUserId(entry.userId),
    totalPnl: Math.round(entry.totalPnl),
    winRate: entry.winRate,
    tradesCount: entry.tradesCount,
    isCurrentUser: entry.userId === currentUserId,
  }))

  res.json({ ok: true, leaderboard })
})

app.post('/api/trades/orders', requireAuth, async (req, res) => {
  const payload = asRecord(req.body)
  const userId = req.authenticatedUserId
  const matchId = Number(payload.matchId)
  const marketId = Number(payload.marketId ?? 1)
  const marketTitle = String(payload.marketTitle ?? 'Market')
  const optionLabel = String(payload.optionLabel ?? '').trim()
  const amount = Number(payload.amount)

  // Strict side validation
  const rawSide = String(payload.side ?? '').toLowerCase()
  if (rawSide !== 'yes' && rawSide !== 'no') {
    return res.status(400).json({ ok: false, error: 'side must be "yes" or "no"', code: 'INVALID_SIDE' })
  }
  const side = rawSide

  if (!Number.isFinite(matchId) || matchId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid matchId', code: 'INVALID_MATCH_ID' })
  }
  if (!Number.isFinite(marketId) || marketId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid marketId', code: 'INVALID_MARKET_ID' })
  }
  if (!optionLabel) {
    return res.status(400).json({ ok: false, error: 'optionLabel is required', code: 'INVALID_OPTION' })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'amount must be a positive number', code: 'INVALID_AMOUNT' })
  }

  const user = await ensureUserAsync(userId)
  if (user.suspended) {
    res.status(403).json({ ok: false, error: 'User is suspended from trading', code: 'USER_SUSPENDED' })
    return
  }

  const match = state.matches.find((entry) => entry.id === matchId)
  if (!match) {
    res.status(404).json({ ok: false, error: 'Match not found', code: 'MATCH_NOT_FOUND' })
    return
  }

  const marketStatus = state.marketStatusByMatch.get(matchId)
  if (marketStatus?.suspended) {
    res.status(409).json({ ok: false, error: marketStatus.reason || 'Market is suspended by risk team', code: 'MARKET_SUSPENDED' })
    return
  }

  const marketOption = findMarketOption(matchId, marketId, optionLabel)
  if (!marketOption) {
    res.status(404).json({ ok: false, error: 'Market/option not found', code: 'MARKET_OPTION_NOT_FOUND' })
    return
  }

  const livePrice = side === 'yes' ? marketOption.option.price : clampPrice(100 - marketOption.option.price)
  // Use exact shares (2 decimal places) to avoid rounding losses on sell
  const shares = Math.round((amount / (livePrice / 100)) * 100) / 100

  if (shares <= 0) {
    res.status(400).json({ ok: false, error: 'Amount too low for current price', code: 'AMOUNT_TOO_LOW' })
    return
  }

  const requiredStake = amount
  const effectiveBalance = user.balance - (user.heldBalance ?? 0)

  if (requiredStake > effectiveBalance) {
    res.status(409).json({ ok: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' })
    return
  }

  const userExposure = getUserOpenExposure(user.userId)
  if (userExposure + requiredStake > MAX_USER_EXPOSURE) {
    res.status(409).json({
      ok: false,
      error: `User exposure limit exceeded (${MAX_USER_EXPOSURE})`,
      code: 'USER_EXPOSURE_LIMIT',
    })
    return
  }

  const matchExposure = getMatchOpenExposure(matchId)
  if (matchExposure + requiredStake > MAX_MATCH_EXPOSURE) {
    res.status(409).json({
      ok: false,
      error: `Match exposure limit exceeded (${MAX_MATCH_EXPOSURE})`,
      code: 'MATCH_EXPOSURE_LIMIT',
    })
    return
  }

  // Capture original state for rollback
  const originalBalance = user.balance

  user.balance -= requiredStake

  const position = {
    id: Date.now() + Math.floor(Math.random() * 10000),
    userId: user.userId,
    matchId,
    matchLabel: `${match.teamA} vs ${match.teamB}`,
    marketId,
    marketTitle,
    optionLabel: marketOption.option.label,
    side,
    avgPrice: livePrice,
    shares,
    sharesRemaining: shares,
    stake: requiredStake,
    stakeRemaining: requiredStake,
    status: 'open',
    isLive: match.isLive,
    openedAt: nowIso(),
  }

  const positions = getUserPositions(user.userId)
  positions.unshift(position)
  state.positionsByUser.set(user.userId, positions)

  const order = {
    id: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId: user.userId,
    matchId,
    marketId,
    optionLabel: marketOption.option.label,
    side,
    amount: requiredStake,
    price: livePrice,
    at: nowIso(),
  }
  state.orders.unshift(order)

  appendAudit('order_placed', {
    userId: user.userId,
    matchId,
    marketId,
    side,
    amount: requiredStake,
    shares,
  })

  // Persist to Supabase with rollback on failure
  if (supabaseAdmin) {
    try {
      const [orderResult, positionResult, walletResult] = await Promise.all([
        // Insert order record
        supabaseAdmin.from('all_orders').insert({
          user_id: user.userId,
          match_id: matchId,
          market_id: marketId,
          option_label: marketOption.option.label,
          side,
          shares,
          price: livePrice,
          cost: requiredStake,
        }),
        // Insert position record (using server_positions for text user IDs)
        supabaseAdmin.from('server_positions').insert({
          user_id: user.userId,
          match_id: matchId,
          match_label: position.matchLabel,
          market_title: marketTitle,
          option_label: marketOption.option.label,
          side,
          shares,
          avg_price: livePrice,
          cost: requiredStake,
          potential_payout: shares,
          status: 'open',
          is_live: match.isLive,
        }).select('id').single(),
        // Update wallet balance and profile (using server_wallets for text user IDs)
        supabaseAdmin
          .from('server_wallets')
          .update({
            balance: user.balance,
            name: user.name,
            email: user.email,
            updated_at: nowIso(),
          })
          .eq('user_id', user.userId),
      ])

      // Store DB ID if available
      if (positionResult.data?.id) {
        position.dbId = positionResult.data.id
      }

      // Check for errors
      if (orderResult.error || positionResult.error || walletResult.error) {
        throw new Error('DB write failed')
      }

      // Insert wallet transaction (non-critical, fire-and-forget)
      supabaseAdmin.from('server_wallet_transactions').insert({
        user_id: user.userId,
        type: 'debit',
        amount: requiredStake,
        description: `Bought ${marketOption.option.label} ${side.toUpperCase()}`,
        icon: '📉',
      }).catch(() => {})
    } catch (err) {
      // Rollback in-memory state
      logger.error({ err, userId: user.userId, matchId, marketId }, 'Failed to persist trade to Supabase, rolling back')
      user.balance = originalBalance
      const idx = positions.indexOf(position)
      if (idx >= 0) positions.splice(idx, 1)
      const orderIdx = state.orders.indexOf(order)
      if (orderIdx >= 0) state.orders.splice(orderIdx, 1)

      return res.status(500).json({ ok: false, error: 'Trade failed to save, please try again', code: 'PERSIST_FAILED' })
    }
  }

  res.json({
    ok: true,
    order: {
      position,
      balance: user.balance,
      userExposure: getUserOpenExposure(user.userId),
      matchExposure: getMatchOpenExposure(matchId),
    },
  })

  // Socket.io: push trade confirmation and portfolio update to user
  if (io) {
    io.to(`user:${user.userId}`).emit('trade:confirmed', { position, balance: user.balance })
    io.to(`user:${user.userId}`).emit('portfolio:update', {
      balance: user.balance,
      positions: getUserPositions(user.userId),
      exposure: getUserOpenExposure(user.userId),
    })
  }
})

app.post('/api/trades/positions/:positionId/close', requireAuth, async (req, res) => {
  const payload = asRecord(req.body)
  const userId = req.authenticatedUserId
  const positionId = Number(req.params.positionId)
  const sharesToClose = Number(payload.shares)

  if (!Number.isFinite(positionId) || !Number.isFinite(sharesToClose) || sharesToClose <= 0) {
    res.status(400).json({ ok: false, error: 'Invalid close request', code: 'INVALID_CLOSE_REQUEST' })
    return
  }

  const user = await ensureUserAsync(userId)

  // Note: Unlike buy, we allow suspended users to close positions (exit-only mode)
  // But we log this for auditing
  if (user.suspended) {
    logger.info({ userId }, 'Suspended user closing position (allowed for exit-only)')
  }

  const positions = getUserPositions(user.userId)
  const position = positions.find((entry) => entry.id === positionId)

  if (!position || position.status !== 'open') {
    res.status(404).json({ ok: false, error: 'Open position not found', code: 'POSITION_NOT_FOUND' })
    return
  }

  // Verify position ownership
  if (position.userId !== userId) {
    res.status(403).json({ ok: false, error: 'Position does not belong to this user', code: 'POSITION_FORBIDDEN' })
    return
  }

  if (sharesToClose > position.sharesRemaining) {
    res.status(400).json({ ok: false, error: 'Cannot close more shares than remaining' })
    return
  }

  const marketOption = findMarketOption(position.matchId, position.marketId, position.optionLabel)
  if (!marketOption) {
    res.status(404).json({ ok: false, error: 'Live market option unavailable' })
    return
  }

  const livePrice =
    position.side === 'yes'
      ? marketOption.option.price
      : clampPrice(100 - marketOption.option.price)

  // Round all monetary values to 2 decimal places
  const closeValue = Math.round(sharesToClose * (livePrice / 100) * 100) / 100
  const proportionalStake = Math.round(position.stakeRemaining * (sharesToClose / position.sharesRemaining) * 100) / 100
  const pnl = Math.round((closeValue - proportionalStake) * 100) / 100

  // Capture original state for rollback
  const originalBalance = user.balance
  const originalSharesRemaining = position.sharesRemaining
  const originalStakeRemaining = position.stakeRemaining
  const originalStatus = position.status
  const originalClosedAt = position.closedAt

  user.balance = Math.round((user.balance + closeValue) * 100) / 100

  position.sharesRemaining = Math.round((position.sharesRemaining - sharesToClose) * 100) / 100
  position.stakeRemaining = Math.round((position.stakeRemaining - proportionalStake) * 100) / 100

  if (position.sharesRemaining <= 0.01) {
    position.status = 'closed'
    position.closedAt = nowIso()
  }

  appendAudit('position_closed', {
    userId: user.userId,
    positionId,
    sharesToClose,
    livePrice,
    pnl,
  })

  // Persist to Supabase with rollback on failure
  if (supabaseAdmin) {
    // Build position update query - use dbId if available for precise targeting
    let positionUpdate = supabaseAdmin
      .from('server_positions')
      .update({
        shares: position.sharesRemaining,
        cost: position.stakeRemaining,
        status: position.status,
        closed_at: position.closedAt || null,
      })
    if (position.dbId) {
      positionUpdate = positionUpdate.eq('id', position.dbId)
    } else {
      // Fallback: match by user + match criteria (may update multiple if duplicates exist)
      positionUpdate = positionUpdate
        .eq('user_id', user.userId)
        .eq('match_id', position.matchId)
        .eq('option_label', position.optionLabel)
        .eq('side', position.side)
        .eq('status', 'open')
    }

    try {
      const [positionResult, walletResult] = await Promise.all([
        positionUpdate,
        // Update wallet balance and profile
        supabaseAdmin
          .from('server_wallets')
          .update({
            balance: user.balance,
            name: user.name,
            email: user.email,
            updated_at: nowIso(),
          })
          .eq('user_id', user.userId),
      ])

      if (positionResult.error || walletResult.error) {
        throw new Error('DB write failed')
      }

      // Insert wallet transaction (non-critical, fire-and-forget)
      supabaseAdmin.from('server_wallet_transactions').insert({
        user_id: user.userId,
        type: 'credit',
        amount: closeValue,
        description: `Sold ${sharesToClose} shares of ${position.optionLabel}`,
        icon: pnl >= 0 ? '📈' : '📉',
      }).catch(() => {})
    } catch (err) {
      // Rollback in-memory state
      logger.error({ err, userId: user.userId, positionId }, 'Failed to persist position close to Supabase, rolling back')
      user.balance = originalBalance
      position.sharesRemaining = originalSharesRemaining
      position.stakeRemaining = originalStakeRemaining
      position.status = originalStatus
      position.closedAt = originalClosedAt

      return res.status(500).json({ ok: false, error: 'Position close failed to save, please try again', code: 'PERSIST_FAILED' })
    }
  }

  res.json({
    ok: true,
    close: {
      position,
      closedShares: sharesToClose,
      closeValue,
      pnl,
      balance: user.balance,
      positions: getUserPositions(userId),
      exposure: getUserOpenExposure(userId),
    },
  })

  // Socket.io: push portfolio update to user
  if (io) {
    io.to(`user:${userId}`).emit('portfolio:update', {
      balance: user.balance,
      positions: getUserPositions(userId),
      exposure: getUserOpenExposure(userId),
    })
  }
})

// ============================================================
// Withdrawal endpoints
// ============================================================

app.post('/api/withdrawals', requireAuth, async (req, res) => {
  const userId = req.authenticatedUserId
  const payload = asRecord(req.body)
  const amount = Number(payload.amount)
  const upiId = String(payload.upiId ?? '').trim()
  const bankDetails = String(payload.bankDetails ?? '').trim()

  if (!Number.isFinite(amount) || amount < 500) {
    return res.status(400).json({ ok: false, error: 'Minimum withdrawal is Rs 500', code: 'MIN_WITHDRAWAL' })
  }

  if (!upiId && !bankDetails) {
    return res.status(400).json({ ok: false, error: 'UPI ID or bank details required', code: 'PAYMENT_DETAILS_REQUIRED' })
  }

  if (!supabaseAdmin) {
    return res.status(503).json({ ok: false, error: 'Withdrawal service unavailable', code: 'SERVICE_UNAVAILABLE' })
  }

  try {
    // Check wallet from Supabase
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('server_wallets')
      .select('balance, bonus_balance, held_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ ok: false, error: 'Wallet not found', code: 'WALLET_NOT_FOUND' })
    }

    // Earned balance = total balance minus signup bonus
    const earnedBalance = wallet.balance - wallet.bonus_balance
    if (earnedBalance < 500) {
      return res.status(409).json({
        ok: false,
        error: `Earned balance must be at least Rs 500 to withdraw. Current earned: Rs ${earnedBalance.toFixed(0)}. Signup bonus does not count.`,
        code: 'INSUFFICIENT_EARNED',
      })
    }

    const availableBalance = wallet.balance - wallet.held_balance
    if (amount > availableBalance) {
      return res.status(409).json({
        ok: false,
        error: 'Amount exceeds available balance (some funds may be held for pending withdrawals)',
        code: 'INSUFFICIENT_AVAILABLE',
      })
    }

    // Check no pending withdrawal already exists
    const { data: pending } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .limit(1)

    if (pending && pending.length > 0) {
      return res.status(409).json({ ok: false, error: 'You already have a pending withdrawal request', code: 'PENDING_EXISTS' })
    }

    // Hold the funds
    const { error: holdError } = await supabaseAdmin
      .from('server_wallets')
      .update({ held_balance: wallet.held_balance + amount })
      .eq('user_id', userId)

    if (holdError) {
      logger.error({ holdError, userId, amount }, 'Failed to hold funds')
      return res.status(500).json({ ok: false, error: 'Failed to hold funds', code: 'HOLD_FAILED' })
    }

    // Create withdrawal request
    const { data: request, error: insertError } = await supabaseAdmin
      .from('withdrawal_requests')
      .insert({ user_id: userId, amount, upi_id: upiId || null, bank_details: bankDetails || null })
      .select()
      .single()

    if (insertError) {
      // Rollback hold
      await supabaseAdmin.from('server_wallets')
        .update({ held_balance: Math.max(0, wallet.held_balance) })
        .eq('user_id', userId)
      logger.error({ insertError, userId, amount }, 'Failed to create withdrawal request')
      return res.status(500).json({ ok: false, error: 'Failed to create withdrawal request', code: 'INSERT_FAILED' })
    }

    // Update gateway in-memory user state
    const gatewayUser = state.users.get(userId)
    if (gatewayUser) {
      gatewayUser.heldBalance = (gatewayUser.heldBalance ?? 0) + amount
    }

    appendAudit('withdrawal_requested', { userId, amount, requestId: request.id, upiId: upiId || undefined })
    logger.info({ userId, amount, requestId: request.id }, 'Withdrawal request created')

    res.json({ ok: true, request })

    // Socket.io: notify admin of new withdrawal request
    if (io) {
      io.to('admin').emit('admin:withdrawal_request', { request, userId })
    }
  } catch (err) {
    logger.error({ err, userId }, 'Withdrawal request error')
    res.status(500).json({ ok: false, error: 'Internal error processing withdrawal', code: 'INTERNAL_ERROR' })
  }
})

app.get('/api/admin/withdrawals', requireAdmin, async (_req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured', code: 'SERVICE_UNAVAILABLE' })
  }

  try {
    const { data: requests, error } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('*, profiles!inner(phone, full_name)')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      logger.error({ error }, 'Failed to fetch withdrawal requests')
      return res.status(500).json({ ok: false, error: 'Failed to fetch withdrawal requests' })
    }

    res.json({ ok: true, requests: requests ?? [] })
  } catch (err) {
    logger.error({ err }, 'Admin withdrawals error')
    res.status(500).json({ ok: false, error: 'Internal error' })
  }
})

app.post('/api/admin/withdrawals/:requestId/approve', requireAdmin, async (req, res) => {
  const requestId = Number(req.params.requestId)
  const payload = asRecord(req.body)
  const adminNotes = String(payload.adminNotes ?? '').trim()

  if (!supabaseAdmin) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured' })
  }

  try {
    // Fetch the pending request
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .eq('status', 'pending')
      .single()

    if (fetchError || !request) {
      return res.status(404).json({ ok: false, error: 'Pending withdrawal request not found', code: 'NOT_FOUND' })
    }

    // Get wallet
    const { data: wallet } = await supabaseAdmin
      .from('server_wallets')
      .select('balance, held_balance')
      .eq('user_id', request.user_id)
      .single()

    if (!wallet) {
      return res.status(500).json({ ok: false, error: 'Wallet not found' })
    }

    // Deduct from balance and release hold
    await supabaseAdmin
      .from('server_wallets')
      .update({
        balance: Math.max(0, wallet.balance - request.amount),
        held_balance: Math.max(0, wallet.held_balance - request.amount),
      })
      .eq('user_id', request.user_id)

    // Update request status to 'sent'
    await supabaseAdmin
      .from('withdrawal_requests')
      .update({ status: 'sent', admin_notes: adminNotes || null })
      .eq('id', requestId)

    // Add wallet transaction record
    await supabaseAdmin.from('wallet_transactions').insert({
      user_id: request.user_id,
      type: 'debit',
      amount: request.amount,
      description: `Withdrawal of Rs ${request.amount} approved`,
      icon: '💸',
    })

    // Add notification for user
    await supabaseAdmin.from('user_notifications').insert({
      user_id: request.user_id,
      title: 'Withdrawal Approved',
      text: `Your withdrawal of Rs ${request.amount} has been approved and will be sent shortly.`,
      icon: '💸',
    })

    // Update gateway in-memory state
    const gatewayUser = state.users.get(request.user_id)
    if (gatewayUser) {
      gatewayUser.balance = Math.max(0, gatewayUser.balance - request.amount)
      gatewayUser.heldBalance = Math.max(0, (gatewayUser.heldBalance ?? 0) - request.amount)
    }

    appendAudit('withdrawal_approved', { requestId, userId: request.user_id, amount: request.amount })
    logger.info({ requestId, userId: request.user_id, amount: request.amount }, 'Withdrawal approved')

    res.json({ ok: true })
  } catch (err) {
    logger.error({ err, requestId }, 'Withdrawal approve error')
    res.status(500).json({ ok: false, error: 'Internal error' })
  }
})

app.post('/api/admin/withdrawals/:requestId/reject', requireAdmin, async (req, res) => {
  const requestId = Number(req.params.requestId)
  const payload = asRecord(req.body)
  const adminNotes = String(payload.adminNotes ?? '').trim()

  if (!supabaseAdmin) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured' })
  }

  try {
    const { data: request, error: fetchError } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('*')
      .eq('id', requestId)
      .eq('status', 'pending')
      .single()

    if (fetchError || !request) {
      return res.status(404).json({ ok: false, error: 'Pending withdrawal request not found', code: 'NOT_FOUND' })
    }

    // Release hold
    const { data: wallet } = await supabaseAdmin
      .from('server_wallets')
      .select('held_balance')
      .eq('user_id', request.user_id)
      .single()

    if (wallet) {
      await supabaseAdmin
        .from('server_wallets')
        .update({ held_balance: Math.max(0, wallet.held_balance - request.amount) })
        .eq('user_id', request.user_id)
    }

    await supabaseAdmin
      .from('withdrawal_requests')
      .update({ status: 'rejected', admin_notes: adminNotes || null })
      .eq('id', requestId)

    // Notify user
    await supabaseAdmin.from('user_notifications').insert({
      user_id: request.user_id,
      title: 'Withdrawal Rejected',
      text: `Your withdrawal request of Rs ${request.amount} was rejected.${adminNotes ? ' Reason: ' + adminNotes : ''}`,
      icon: '❌',
    })

    // Update gateway in-memory state
    const gatewayUser = state.users.get(request.user_id)
    if (gatewayUser) {
      gatewayUser.heldBalance = Math.max(0, (gatewayUser.heldBalance ?? 0) - request.amount)
    }

    appendAudit('withdrawal_rejected', { requestId, userId: request.user_id, amount: request.amount })
    logger.info({ requestId, userId: request.user_id, amount: request.amount }, 'Withdrawal rejected')

    res.json({ ok: true })
  } catch (err) {
    logger.error({ err, requestId }, 'Withdrawal reject error')
    res.status(500).json({ ok: false, error: 'Internal error' })
  }
})

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  if (Date.now() - state.fetchedAt > POLL_INTERVAL_MS) {
    await refreshGateway()
  }

  res.json({
    ok: true,
    overview: buildAdminOverview(),
  })
})

app.post('/api/admin/market/:matchId/pause', requireAdmin, (req, res) => {
  const matchId = Number(req.params.matchId)
  const payload = asRecord(req.body)
  const suspended = Boolean(payload.suspended)
  const reason = String(payload.reason ?? '').trim()

  if (!Number.isFinite(matchId)) {
    res.status(400).json({ ok: false, error: 'Invalid match id' })
    return
  }

  state.marketStatusByMatch.set(matchId, {
    suspended,
    reason,
    updatedAt: nowIso(),
  })

  appendAudit('market_risk_update', {
    matchId,
    suspended,
    reason,
  })

  res.json({
    ok: true,
    matchId,
    suspended,
    reason,
  })

  // Socket.io: push market status change to match room
  if (io) {
    const markets = state.marketsByMatch.get(matchId) ?? []
    io.to(`match:${matchId}`).emit('markets:update', {
      matchId,
      markets,
      tradingStatus: { suspended, reason },
    })
  }
})

app.post('/api/admin/user/:userId/suspend', requireAdmin, (req, res) => {
  const payload = asRecord(req.body)
  const userId = String(req.params.userId ?? '').trim()
  const suspended = Boolean(payload.suspended)
  const reason = String(payload.reason ?? '').trim()

  if (!userId) {
    res.status(400).json({ ok: false, error: 'Invalid user id' })
    return
  }

  const user = ensureUser(userId)
  user.suspended = suspended

  appendAudit('user_risk_update', {
    userId,
    suspended,
    reason,
  })

  res.json({
    ok: true,
    userId,
    suspended,
    reason,
  })
})

app.post('/api/admin/settle/:matchId', requireAdmin, (req, res) => {
  const matchId = Number(req.params.matchId)
  const payload = asRecord(req.body)

  if (!Number.isFinite(matchId)) {
    res.status(400).json({ ok: false, error: 'Invalid match id' })
    return
  }

  const winnerTeam = payload.winnerTeam ? String(payload.winnerTeam) : null
  const settlement = settleMatch(matchId, winnerTeam, 'admin')

  if (!settlement.ok) {
    res.status(409).json(settlement)
    return
  }

  res.json(settlement)

  // Socket.io: broadcast updated matches and admin overview after settlement
  if (io) {
    io.emit('matches:update', { matches: state.matches })
    io.to('admin').emit('admin:overview', { overview: buildAdminOverview() })
  }
})

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const limit = clamp(Number(req.query.limit ?? 200), 10, 500)

  res.json({
    ok: true,
    audits: state.audits.slice(-limit).reverse(),
  })
})

if (SERVE_FRONTEND) {
  app.use((req, res, next) => {
    const method = String(req.method ?? '').toUpperCase()
    if ((method !== 'GET' && method !== 'HEAD') || req.path.startsWith('/api/')) {
      next()
      return
    }

    if (!fs.existsSync(FRONTEND_INDEX_FILE)) {
      res.status(503).json({
        ok: false,
        error:
          'Frontend build not found. Run `npm run build` before starting with SERVE_FRONTEND=true.',
      })
      return
    }

    res.sendFile(FRONTEND_INDEX_FILE)
  })
}

/**
 * Bootstrap state from Supabase on server startup
 * Restores user balances, open positions, and settlement records
 */
async function bootstrapFromSupabase() {
  if (!supabaseAdmin) {
    logger.warn('Supabase not configured — starting with empty state')
    return
  }

  logger.info('Bootstrapping state from Supabase...')

  try {
    // 1. Restore wallet balances (from server_wallets for text user IDs)
    const { data: wallets, error: walletsError } = await supabaseAdmin
      .from('server_wallets')
      .select('user_id, balance, bonus_balance, held_balance')

    if (walletsError) {
      logger.error({ error: walletsError }, 'Failed to load wallet accounts from Supabase')
    } else if (wallets) {
      for (const wallet of wallets) {
        const user = ensureUser(wallet.user_id)
        user.balance = Number(wallet.balance) || STARTING_BALANCE
        user.bonusBalance = Number(wallet.bonus_balance) || 0
        user.heldBalance = Number(wallet.held_balance) || 0
      }
      logger.info(`Restored ${wallets.length} wallet account(s)`)

      // If test mode is enabled and user-123 doesn't have a wallet, create one
      if (DISABLE_AUTH_FOR_TESTING) {
        const hasTestUser = wallets.some(w => w.user_id === 'user-123')
        if (!hasTestUser) {
          logger.info('Test mode: Creating wallet for user-123')
          await supabaseAdmin.from('server_wallets').upsert({
            user_id: 'user-123',
            balance: STARTING_BALANCE,
            bonus_balance: 0,
            held_balance: 0,
          })
          const user = ensureUser('user-123')
          user.balance = STARTING_BALANCE
        }
      }
    }

    // 2. Restore open positions (from server_positions for text user IDs)
    const { data: positions, error: positionsError } = await supabaseAdmin
      .from('server_positions')
      .select('*')
      .eq('status', 'open')

    if (positionsError) {
      logger.error({ error: positionsError }, 'Failed to load positions from Supabase')
    } else if (positions) {
      for (const dbPosition of positions) {
        // Find the match for this position
        const match = state.matches.find((m) => m.id === dbPosition.match_id)

        // Convert DB position to in-memory format
        const position = {
          id: Date.now() + Math.floor(Math.random() * 10000), // Generate new in-memory ID
          userId: dbPosition.user_id,
          matchId: dbPosition.match_id,
          matchLabel: dbPosition.match_label,
          marketId: 1, // Default to market 1 (match winner) for now
          marketTitle: dbPosition.market_title,
          optionLabel: dbPosition.option_label,
          side: dbPosition.side,
          avgPrice: Number(dbPosition.avg_price),
          shares: Number(dbPosition.shares),
          sharesRemaining: Number(dbPosition.shares),
          stake: Number(dbPosition.cost),
          stakeRemaining: Number(dbPosition.cost),
          status: 'open',
          isLive: match?.isLive ?? false,
          openedAt: dbPosition.created_at,
        }

        // Add to user's positions
        const userPositions = getUserPositions(dbPosition.user_id)
        userPositions.push(position)
        state.positionsByUser.set(dbPosition.user_id, userPositions)
      }
      logger.info(`Restored ${positions.length} open position(s)`)
    }

    // 3. Restore match settlements
    const { data: settlements, error: settlementsError } = await supabaseAdmin
      .from('match_settlements')
      .select('*')

    if (settlementsError) {
      logger.error({ error: settlementsError }, 'Failed to load settlements from Supabase')
    } else if (settlements) {
      for (const dbSettlement of settlements) {
        const settlement = {
          matchId: dbSettlement.match_id,
          winnerCode: dbSettlement.winner_code,
          winnerFull: dbSettlement.winner_full,
          settledAt: dbSettlement.settled_at,
          settledBy: dbSettlement.settled_by,
          rows: [], // We don't need to restore individual rows
        }
        state.settlementsByMatch.set(dbSettlement.match_id, settlement)
      }
      logger.info(`Restored ${settlements.length} match settlement(s)`)
    }

    // 4. Restore recent price history (last 4 hours)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
    const { data: historyRows, error: historyError } = await supabaseAdmin
      .from('server_price_history')
      .select('market_key, price, recorded_at')
      .gte('recorded_at', fourHoursAgo)
      .order('recorded_at', { ascending: true })

    if (historyError) {
      logger.error({ error: historyError }, 'Failed to load price history from Supabase')
    } else if (historyRows) {
      for (const row of historyRows) {
        const existing = state.historyByMarketKey.get(row.market_key) ?? []
        existing.push({ at: row.recorded_at, price: row.price })
        state.historyByMarketKey.set(row.market_key, existing)
      }
      logger.info(`Restored ${historyRows.length} price history point(s)`)
    }

    logger.info('Bootstrap from Supabase completed successfully')
  } catch (err) {
    logger.error({ err }, 'Bootstrap from Supabase failed — continuing with empty state')
  }
}

async function bootstrap() {
  if (!CRICKETDATA_API_KEY) {
    appendAudit('gateway_bootstrap_warning', {
      message: 'CRICKETDATA_API_KEY is missing. Gateway will stay empty until key is set.',
    })
  }

  if (SERVE_FRONTEND && !fs.existsSync(FRONTEND_INDEX_FILE)) {
    appendAudit('frontend_bootstrap_warning', {
      message: 'SERVE_FRONTEND=true but dist/index.html is missing. Build frontend before launch.',
    })
  }

  if (!SUPABASE_URL) {
    logger.warn('SUPABASE_URL not set — database features disabled, running in demo mode')
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn('SUPABASE_SERVICE_ROLE_KEY not set — auth verification and withdrawals disabled')
  }
  if (DISABLE_AUTH_FOR_TESTING) {
    logger.warn('⚠️  DISABLE_AUTH_FOR_TESTING=true — Authentication bypassed, using hardcoded user-123. DO NOT USE IN PRODUCTION!')
  }
  if (ADMIN_API_KEY === 'admin-local-key') {
    logger.warn('ADMIN_API_KEY is using default value "admin-local-key" — change this for production')
  }

  // Bootstrap state from Supabase before starting data refresh
  await bootstrapFromSupabase()

  await refreshGateway()

  setInterval(() => {
    void refreshGateway()
  }, POLL_INTERVAL_MS)

  // ============================================================
  // Socket.io — real-time push layer
  // ============================================================

  const httpServer = createServer(app)

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS || '*',
      methods: ['GET', 'POST'],
      credentials: Boolean(ALLOWED_ORIGINS),
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
  })

  // Socket.io authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token ?? ''

    // Dev fallback: if no Supabase configured, allow unauthenticated connections
    if (!supabaseAdmin) {
      socket.userId = socket.handshake.auth?.userId ?? 'guest'
      socket.isAdmin = socket.handshake.auth?.adminKey === ADMIN_API_KEY
      return next()
    }

    if (!token) {
      // Allow unauthenticated connections but mark as guest
      socket.userId = 'guest'
      socket.isAdmin = socket.handshake.auth?.adminKey === ADMIN_API_KEY
      return next()
    }

    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !user) {
        socket.userId = 'guest'
        socket.isAdmin = false
        return next()
      }
      socket.userId = user.id
      socket.isAdmin = false
      next()
    } catch (err) {
      logger.error({ err }, 'Socket auth verification failed')
      socket.userId = 'guest'
      socket.isAdmin = false
      next()
    }
  })

  // Socket.io connection handler
  io.on('connection', (socket) => {
    const userId = socket.userId
    logger.info({ socketId: socket.id, userId }, 'Socket connected')

    // Join user-specific room
    if (userId && userId !== 'guest') {
      socket.join(`user:${userId}`)
    }

    // Join admin room if admin key provided
    const adminKey = socket.handshake.auth?.adminKey
    if (adminKey && adminKey === ADMIN_API_KEY) {
      socket.isAdmin = true
      socket.join('admin')
      logger.info({ socketId: socket.id }, 'Admin socket joined admin room')
    }

    // Client requests to watch a specific match
    socket.on('match:subscribe', (matchId) => {
      const numericId = Number(matchId)
      if (!Number.isFinite(numericId)) return
      socket.join(`match:${numericId}`)
      logger.debug({ socketId: socket.id, matchId: numericId }, 'Subscribed to match room')
    })

    // Client leaves a match room
    socket.on('match:unsubscribe', (matchId) => {
      const numericId = Number(matchId)
      if (!Number.isFinite(numericId)) return
      socket.leave(`match:${numericId}`)
      logger.debug({ socketId: socket.id, matchId: numericId }, 'Unsubscribed from match room')
    })

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, userId, reason }, 'Socket disconnected')
    })
  })

  httpServer.listen(PORT, () => {
    logger.info({ port: PORT, feedSource: state.feedSource, pollMs: POLL_INTERVAL_MS }, 'Gateway server started')
    if (SERVE_FRONTEND) {
      if (fs.existsSync(FRONTEND_INDEX_FILE)) {
        logger.info({ dir: FRONTEND_DIST_DIR }, 'Serving frontend')
      } else {
        logger.warn('dist/index.html missing; web routes will return 503 until frontend is built')
      }
    }
    if (supabaseAdmin) {
      logger.info('Supabase admin client active — auth verification & withdrawals enabled')
    }
    logger.info('Socket.io real-time engine active')
  })
}

void bootstrap()
