import logoHarvard from "../../assets/row-logo-harvard.png";
import logoGeorgiaTech from "../../assets/row-logo-georgia-tech.png";
import logoUmich from "../../assets/row-logo-umich.png";
import logoStanford from "../../assets/row-logo-stanford.png";
import logoPurdue from "../../assets/row-logo-purdue.png";

export type Tier = "reach" | "target" | "safety";

export type School = {
  id: string;
  name: string;
  logo: string;
  tier: Tier;
  /** One line on why it is on the list, in the student's terms. */
  reason: string;
  /** Position on the fit map, in percent: chances left to right, fit bottom to top. */
  chances: number;
  fit: number;
};

export const TIERS: { id: Tier; label: string }[] = [
  { id: "reach", label: "Reach" },
  { id: "target", label: "Target" },
  { id: "safety", label: "Safety" },
];

/** Reading order: reach, then target, then safety. */
export const SCHOOLS: School[] = [
  {
    id: "harvard",
    name: "Harvard",
    logo: logoHarvard,
    tier: "reach",
    reason: "Admits under 4%",
    chances: 9,
    fit: 60,
  },
  {
    id: "stanford",
    name: "Stanford",
    logo: logoStanford,
    tier: "reach",
    reason: "Top CS, admits under 4%",
    chances: 20,
    fit: 70,
  },
  {
    id: "georgia-tech",
    name: "Georgia Tech",
    logo: logoGeorgiaTech,
    tier: "target",
    reason: "$18k a year after aid",
    chances: 44,
    fit: 78,
  },
  {
    id: "umich",
    name: "Michigan",
    logo: logoUmich,
    tier: "target",
    reason: "Strong CS, 18% admit",
    chances: 60,
    fit: 55,
  },
  {
    id: "purdue",
    name: "Purdue",
    logo: logoPurdue,
    tier: "safety",
    reason: "Top 20 CS, half admitted",
    chances: 86,
    fit: 64,
  },
];

export const tierLabel = (tier: Tier) =>
  TIERS.find((entry) => entry.id === tier)!.label;
