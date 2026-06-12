/**
 * Counselle app configuration fixture.
 * FE-5 may replace with a real /api/config endpoint.
 */
export const APP_CONFIG = {
  greeting: 'Where should we begin?',
  season_note: "It's June — rising seniors are building college lists.",
  conversation_starters: [
    'Build me a dossier on NYU',
    'Compare Vanderbilt and Emory for premed',
    'What are my chances at Northeastern?',
    'How does need-based aid work at Tulane?',
  ],
  footer:
    'Counselle can make mistakes — every number is cited; check the source. | Data: CDS · IPEDS · College Scorecard',
} as const;

export type AppConfig = typeof APP_CONFIG;
