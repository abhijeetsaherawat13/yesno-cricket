import { DataSource, registerSource } from './index.js';

// Mock data source for development and testing
class MockDataSource extends DataSource {
  constructor() {
    super('mock');
    this.matches = [
      {
        matchKey: 'ind-vs-aus-2024-02-18',
        teamA: 'India',
        teamB: 'Australia',
        teamAShort: 'IND',
        teamBShort: 'AUS',
        matchType: 'T20',
        category: 'International',
        statusText: 'Live',
        timeLabel: 'Now',
        isLive: true,
        priceA: 55,
        priceB: 45,
        provider: 'mock'
      },
      {
        matchKey: 'eng-vs-sa-2024-02-18',
        teamA: 'England',
        teamB: 'South Africa',
        teamAShort: 'ENG',
        teamBShort: 'SA',
        matchType: 'ODI',
        category: 'International',
        statusText: 'Starts at 14:00',
        timeLabel: 'Feb 18, 2:00 PM',
        isLive: false,
        priceA: 48,
        priceB: 52,
        provider: 'mock'
      },
      {
        matchKey: 'csk-vs-mi-2024-02-19',
        teamA: 'Chennai Super Kings',
        teamB: 'Mumbai Indians',
        teamAShort: 'CSK',
        teamBShort: 'MI',
        matchType: 'T20',
        category: 'T20 Leagues',
        statusText: 'Tomorrow',
        timeLabel: 'Feb 19, 7:30 PM',
        isLive: false,
        priceA: 50,
        priceB: 50,
        provider: 'mock'
      }
    ];
  }

  async fetchMatches() {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Add some price variation
    return this.matches.map(match => ({
      ...match,
      priceA: match.isLive ? this.varyPrice(match.priceA) : match.priceA,
      priceB: match.isLive ? this.varyPrice(match.priceB) : match.priceB
    }));
  }

  async fetchOdds(matchKey) {
    const match = this.matches.find(m => m.matchKey === matchKey);
    if (!match) return null;

    return {
      priceA: this.varyPrice(match.priceA),
      priceB: this.varyPrice(match.priceB)
    };
  }

  varyPrice(price) {
    const variation = (Math.random() - 0.5) * 4; // +/- 2
    return Math.max(1, Math.min(99, Math.round(price + variation)));
  }
}

// Auto-register if MOCK_DATA is enabled
export function initMockSource() {
  if (process.env.MOCK_DATA === 'true' || process.env.NODE_ENV === 'test') {
    registerSource('mock', new MockDataSource());
  }
}

export default MockDataSource;
