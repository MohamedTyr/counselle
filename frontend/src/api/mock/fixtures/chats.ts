import type { ChatRecord } from '@/api/types';

/** ~12 fixture chats with realistic Counselle titles spread across all date groups. */
export const FIXTURE_CHATS: ChatRecord[] = [
  // Today
  {
    conversationId: 'chat-001',
    title: 'NYU vs BU for film production',
    updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-002',
    title: 'Vanderbilt CDS deep dive — early decision stats',
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
  // Yesterday
  {
    conversationId: 'chat-003',
    title: 'My chances at Northeastern — 3.7 GPA, 1420 SAT',
    updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-004',
    title: 'UC Berkeley out-of-state acceptance rate trends',
    updatedAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString(),
  },
  // Previous 7 days
  {
    conversationId: 'chat-005',
    title: 'Comparing financial aid packages — Tulane vs Fordham',
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-006',
    title: 'What is the Common Data Set and how do I read it?',
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString(),
  },
  // Previous 30 days
  {
    conversationId: 'chat-007',
    title: 'Georgetown vs Georgetown — business vs SFS comparison',
    updatedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000 - 90 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-008',
    title: 'Boston College acceptance rate history 2019-2024',
    updatedAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000 - 45 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-009',
    title: 'Am I a good fit for Emory premed track?',
    updatedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000).toISOString(),
  },
  // Older (> 30 days, same year → month group)
  {
    conversationId: 'chat-010',
    title: 'Merit scholarships at University of Rochester',
    updatedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-011',
    title: 'Research opportunities at small liberal arts colleges',
    updatedAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000).toISOString(),
  },
  {
    conversationId: 'chat-012',
    title: 'Transfer admission rates — top 50 schools overview',
    updatedAt: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000 - 2 * 60 * 60 * 1000).toISOString(),
  },
];
