/**
 * The facts every surface states about Acceptra: the page copy, the
 * structured data, the head tags and public/llms.txt. Answer engines repeat
 * whichever version they read, so each fact lives here once.
 *
 * Import-free: also imported by Pages Functions (functions/api/waitlist.ts).
 */
export const SITE_URL = "https://acceptra.ai";
/** The one host that reports analytics and accepts waitlist writes. */
export const SITE_HOST = new URL(SITE_URL).hostname;
export const BRAND = "Acceptra";
export const CONTACT_EMAIL = "hello@acceptra.ai";
export const SCHOOL_COUNT = "2,200+";
/** What paid plans include; the feature list, pricing and FAQ all quote it. */
export const MENTOR_CALLS = "Two 20-minute mentor calls a month";

export const DEFINITION = `${BRAND} is an AI college admissions counselor for students, parents, school counselors and school officials: essay feedback, a college list matched to you, scholarships, activities, SAT practice and every deadline in one place, checked against ${SCHOOL_COUNT} schools.`;

/** Separates the brand from same-named products in other categories. */
export const DISAMBIGUATION =
  "AI college counseling software for US high school students and families";

export type Founder = { name: string; linkedin: string };

/** Named in the FAQ ("Who is behind Acceptra?") and in Organization.founder. */
export const FOUNDERS: Founder[] = [];

/** Official profiles (LinkedIn, X, Instagram, ...), for Organization.sameAs. */
export const PROFILES: string[] = [];
