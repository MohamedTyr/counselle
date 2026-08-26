import type { Fact } from "@/features/schools/facts/school-facts-types";
import { f, page, reported } from "@/features/schools/facts/fixtures/shared";

/* FABRICATED. See fixtures/shared.ts for the full disclaimer. */

export const applyingFacts: Fact[] = [
  f(
    "admissions.notification_mode",
    "Notification mode",
    reported("Fixed date"),
    {
      evidence: page(3, "C16. Notification: by a fixed date", "C16"),
    },
  ),
  f("admissions.rolling_notification_begins", "Rolling notification begins", {
    kind: "not_applicable",
  }),
  f(
    "admissions.regular_notification_date",
    "Regular decision notification",
    reported("April 1"),
    {
      evidence: page(3, "C16. Regular decision notification: April 1", "C16"),
    },
  ),
  f(
    "admissions.spring_admission_offered",
    "Spring admission",
    reported("No", false),
  ),
  f(
    "admissions.deferred_enrollment_offered",
    "Deferred enrolment",
    reported("Yes", true),
  ),
  f(
    "admissions.deferred_enrollment_maximum_period",
    "Maximum deferral",
    reported("One year"),
  ),
  f("admissions.housing_deposit_amount", "Housing deposit", {
    kind: "not_reported",
  }),
  f("admissions.housing_deposit_deadline", "Housing deposit deadline", {
    kind: "not_reported",
  }),
  f("admissions.housing_deposit_refundable", "Housing deposit refundable", {
    kind: "not_reported",
  }),
];
