-- The landing page's waitlist. Every value is allow-listed or length-capped by
-- functions/api/waitlist.ts; the CHECKs repeat that validation so a bad row
-- can't be written even from the console.
CREATE TABLE waitlist (
  email         TEXT PRIMARY KEY,               -- NFC-normalised, trimmed, lowercased by the function
  side          TEXT NOT NULL CHECK (side IN ('me', 'school')),
  source        TEXT NOT NULL,                  -- today: nav | plan | schools | link; length-capped, not enum-checked
  plan          TEXT CHECK (plan IN ('free', 'monthly', 'yearly')),
  role          TEXT CHECK (role IN ('student', 'parent', 'counselor')),
  class_of      TEXT CHECK (class_of IN ('2027', '2028', '2029', 'Later')),
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
