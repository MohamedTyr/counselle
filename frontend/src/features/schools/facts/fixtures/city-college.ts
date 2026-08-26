import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";
import {
  absentTopics,
  caveatRegistry,
  reported,
} from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const cityCollege: SchoolFacts = {
  identity: {
    unitid: 190567,
    name: "The City College of New York",
    city: "New York",
    state: "NY",
    control: "public",
    undergraduates: 13100,
    websiteUrl: "https://www.ccny.cuny.edu",
    domain: "ccny.cuny.edu",
  },
  edition: null,
  coverage: {
    "getting-in": {
      verified: 0,
      configured: 28,
      notInTemplate: 0,
      packet: "missing",
    },
    money: { verified: 0, configured: 67, notInTemplate: 0, packet: "missing" },
    academics: {
      verified: 0,
      configured: 24,
      notInTemplate: 0,
      packet: "missing",
    },
    "campus-life": {
      verified: 0,
      configured: 19,
      notInTemplate: 0,
      packet: "missing",
    },
    outcomes: {
      verified: 0,
      configured: 10,
      notInTemplate: 0,
      packet: "missing",
    },
    /* Our own requirements data is independent of the CDS, so Applying is
     * still populated even with no readable document at all. */
    applying: {
      verified: 4,
      configured: 12,
      notInTemplate: 0,
      packet: "accepted",
    },
  },
  facts: {},
  derived: {},
  caveats: caveatRegistry,
  absent: absentTopics(),
  rounds: [
    {
      code: "RD",
      offered: "yes",
      restrictive: false,
      deadline: {
        id: "ccny-rd",
        label: "Regular decision deadline",
        official: {
          state: reported("February 1, 2027"),
          source: "cuny.edu",
          sourceUrl: "https://www.cuny.edu/admissions/deadlines",
          verifiedAt: "Aug 14, 2026",
        },
        cds: null,
        disagrees: false,
        caveatRefs: [],
      },
      notification: reported("Rolling from March"),
    },
  ],
  applyingLanes: [
    {
      id: "fee",
      label: "Application fee",
      official: {
        state: reported("$65"),
        source: "cuny.edu",
        sourceUrl: "https://www.cuny.edu/admissions/fees",
        verifiedAt: "Aug 14, 2026",
      },
      cds: null,
      disagrees: false,
      caveatRefs: [],
    },
  ],
  degreeShares: [],
};
