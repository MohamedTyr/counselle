/**
 * The facts every surface states about Acceptra: the page copy, the
 * structured data, the head tags and public/llms.txt. Answer engines repeat
 * whichever version they read, so each fact lives here once.
 */
export const SITE_URL = "https://acceptra.ai";
export const BRAND = "Acceptra";
export const CONTACT_EMAIL = "hello@acceptra.ai";
export const SCHOOL_COUNT = "2,700+";

export const DEFINITION = `${BRAND} is an AI college counselor for students, parents, school counselors and school officials: essay feedback, a college list matched to you, scholarships, activities, SAT practice and every deadline in one place, checked against ${SCHOOL_COUNT} schools.`;

/** Separates the brand from same-named products in other categories. */
export const DISAMBIGUATION =
  "AI college counseling software for US high school students and families";

export type Founder = { name: string; linkedin: string };

/** Named in the FAQ ("Who is behind Acceptra?") and in Organization.founder. */
export const FOUNDERS: Founder[] = [];

/** Official profiles (LinkedIn, X, Instagram, ...), for Organization.sameAs. */
export const PROFILES: string[] = [];
