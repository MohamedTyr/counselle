import {
  BRAND,
  CONTACT_EMAIL,
  DEFINITION,
  DISAMBIGUATION,
  FOUNDERS,
  PROFILES,
  SITE_URL,
} from "./brand";
import { QUESTIONS } from "./sections/faqQuestions";
import { PLANS, type Plan } from "./sections/plans";

const ORG_ID = `${SITE_URL}/#org`;
/** Each plan's billing period, as a UN/CEFACT unit and an ISO 8601 duration. */
const BILLING: Record<string, { unitCode: string; billingDuration: string }> = {
  "/month": { unitCode: "MON", billingDuration: "P1M" },
  "/year": { unitCode: "ANN", billingDuration: "P1Y" },
};

function offer(plan: Plan) {
  const price = Number(plan.price.replace(/[^0-9.]/g, ""));
  return {
    "@type": "Offer",
    name: plan.tier,
    description: plan.note,
    price,
    priceCurrency: "USD",
    availability: "https://schema.org/PreOrder",
    url: `${SITE_URL}/#pricing`,
    ...(price > 0 && {
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "USD",
        ...BILLING[plan.period],
      },
    }),
  };
}

/** Built from the data the page renders, so the markup cannot drift from it. */
function structuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: BRAND,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/logo.png`,
        email: CONTACT_EMAIL,
        description: DEFINITION,
        disambiguatingDescription: DISAMBIGUATION,
        ...(FOUNDERS.length > 0 && {
          founder: FOUNDERS.map(({ name, linkedin }) => ({
            "@type": "Person",
            name,
            sameAs: [linkedin],
          })),
        }),
        ...(PROFILES.length > 0 && { sameAs: PROFILES }),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: BRAND,
        alternateName: `${BRAND} AI`,
        url: `${SITE_URL}/`,
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        mainEntity: QUESTIONS.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#app`,
        name: BRAND,
        description: DEFINITION,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web",
        url: `${SITE_URL}/`,
        publisher: { "@id": ORG_ID },
        offers: PLANS.map(offer),
      },
    ],
  };
}

export function StructuredData() {
  const json = JSON.stringify(structuredData()).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
