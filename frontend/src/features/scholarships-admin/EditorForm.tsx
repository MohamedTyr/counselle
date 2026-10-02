import { Plus, X } from "lucide-react";
import { Link } from "react-router";

import type {
  Award,
  AwardKind,
  Basis,
  Deadline,
  Requirements,
  AdminScholarship,
  ScholarshipDraft,
} from "@/api/scholarships/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceSelect } from "@/features/scholarships/ChoiceSelect";
import { daysSince, daysUntil, formatLongDate } from "@/features/scholarships/scholarship-format";
import { SponsorLogo } from "@/features/scholarships/SponsorLogo";
import { todayIso, toggleIn } from "@/features/scholarships-admin/editor-draft";
import { ChoiceChips, EditorSection, Field, NumberInput, TagInput } from "@/features/scholarships-admin/editor-ui";
import { EligibilityEditor } from "@/features/scholarships-admin/EligibilityEditor";

const SUMMARY_LIMIT = 200;

const AWARD_KINDS: { value: AwardKind; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "range", label: "Range" },
  { value: "varies", label: "Varies" },
  { value: "full_tuition", label: "Full tuition" },
  { value: "full_ride", label: "Full ride" },
];

const YEAR_OPTIONS = ["2", "3", "4", "5"].map((value) => ({ value, label: `${value} years` }));

type Patch = (patch: Partial<ScholarshipDraft>) => void;

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-secondary)]">
      <Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      {label}
    </label>
  );
}

function SimilarHint({ name, others }: { name: string; others: AdminScholarship[] }) {
  const needle = name.trim().toLowerCase();
  if (needle.length < 4) return null;
  const match = others.find((item) => {
    const hay = item.name.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
  if (!match) return null;
  return (
    <span>
      Similar:{" "}
      <Link className="underline underline-offset-2 hover:text-[var(--ink)]" to={`/app/admin/scholarships/${match.id}`}>
        {match.name}
      </Link>{" "}
      ({match.status})
    </span>
  );
}

function BasicsSection({ draft, set, others }: { draft: ScholarshipDraft; set: Patch; others: AdminScholarship[] }) {
  return (
    <EditorSection id="ed-basics" title="Basics">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field hint={<SimilarHint name={draft.name} others={others} />} label="Name">
          {(id) => <Input id={id} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Coca-Cola Scholars" value={draft.name} />}
        </Field>
        <Field label="Sponsor">
          {(id) => <Input id={id} onChange={(e) => set({ sponsor: e.target.value })} placeholder="Who gives the award" value={draft.sponsor} />}
        </Field>
        <Field
          className="sm:col-span-2"
          hint={`${draft.summary.length} / ${SUMMARY_LIMIT}`}
          label="Summary"
        >
          {(id) => (
            <Textarea
              id={id}
              maxLength={SUMMARY_LIMIT}
              onChange={(e) => set({ summary: e.target.value })}
              placeholder="One or two sentences on who it's for and what it rewards."
              rows={2}
              value={draft.summary}
            />
          )}
        </Field>
        <Field className="sm:col-span-2" label="Apply link">
          {(id) => <Input id={id} inputMode="url" onChange={(e) => set({ apply_url: e.target.value })} placeholder="https://" value={draft.apply_url} />}
        </Field>
        <Field className="sm:col-span-2" hint="Leave empty to use the source site's icon. Initials show when there's neither." label="Logo">
          {(id) => (
            <div className="flex items-center gap-3">
              <SponsorLogo scholarship={draft} size="lg" />
              <Input id={id} inputMode="url" onChange={(e) => set({ logo_url: e.target.value })} placeholder="https:// — an image of the sponsor's logo" value={draft.logo_url} />
            </div>
          )}
        </Field>
      </div>
    </EditorSection>
  );
}

function AwardSection({ draft, set }: { draft: ScholarshipDraft; set: Patch }) {
  const award = draft.award;
  const setAward = (patch: Partial<Award>) => set({ award: { ...award, ...patch } });
  return (
    <EditorSection id="ed-award" title="Award">
      <SegmentedControl
        label="Award type"
        onValueChange={(kind) =>
          setAward(
            kind === "range" && award.min === null && award.max === null
              ? { kind, max: award.amount }
              : kind === "fixed" && award.amount === null
                ? { kind, amount: award.max }
                : { kind },
          )
        }
        options={AWARD_KINDS}
        value={award.kind}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {award.kind === "fixed" ? (
          <Field label="Amount">
            {(id) => <NumberInput id={id} onChange={(amount) => setAward({ amount })} placeholder="10000" prefix="$" value={award.amount} />}
          </Field>
        ) : null}
        {award.kind === "range" ? (
          <>
            <Field label="From">
              {(id) => <NumberInput id={id} onChange={(min) => setAward({ min })} placeholder="500" prefix="$" value={award.min} />}
            </Field>
            <Field label="Up to">
              {(id) => <NumberInput id={id} onChange={(max) => setAward({ max })} placeholder="5000" prefix="$" value={award.max} />}
            </Field>
          </>
        ) : null}
        <Field hint="Leave empty if not published" label="Awards each cycle">
          {(id) => <NumberInput id={id} onChange={(awards_count) => setAward({ awards_count })} placeholder="Not published" value={award.awards_count} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CheckRow
          checked={award.renewable}
          label="Renews each year"
          onChange={(renewable) => setAward({ renewable, years: renewable ? (award.years ?? 4) : null })}
        />
        {award.renewable ? (
          <ChoiceSelect
            className="w-32"
            onChange={(years) => setAward({ years: years ? Number(years) : null })}
            options={YEAR_OPTIONS}
            placeholder="Years"
            value={award.years ? (String(award.years) as "2") : null}
          />
        ) : null}
      </div>
      <Field label="Based on">
        {() => (
          <ChoiceChips<Basis>
            label="Based on"
            onToggle={(value) => set({ basis: toggleIn(draft.basis, value) })}
            options={[
              { value: "merit", label: "Merit" },
              { value: "need", label: "Financial need" },
            ]}
            selected={draft.basis}
          />
        )}
      </Field>
    </EditorSection>
  );
}

function DatesSection({ draft, set }: { draft: ScholarshipDraft; set: Patch }) {
  const deadline = draft.deadline;
  const setDeadline = (patch: Partial<Deadline>) => set({ deadline: { ...deadline, ...patch } });
  const past = deadline.kind === "fixed" && deadline.date !== null && daysUntil(deadline.date) < 0;
  return (
    <EditorSection id="ed-dates" title="Dates">
      <SegmentedControl
        label="Deadline type"
        onValueChange={(kind) => setDeadline({ kind, date: kind === "rolling" ? null : deadline.date })}
        options={[
          { value: "fixed", label: "Fixed date" },
          { value: "rolling", label: "Rolling" },
        ]}
        value={deadline.kind}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {deadline.kind === "fixed" ? (
          <Field
            error={past ? "This date has passed. Students will see it under Closed." : null}
            label="Due"
          >
            {(id) => <Input id={id} onChange={(e) => setDeadline({ date: e.target.value || null })} type="date" value={deadline.date ?? ""} />}
          </Field>
        ) : null}
        <Field hint="Optional" label="Opens">
          {(id) => <Input id={id} onChange={(e) => setDeadline({ opens_on: e.target.value || null })} type="date" value={deadline.opens_on ?? ""} />}
        </Field>
      </div>
      <CheckRow checked={deadline.recurs_annually} label="Comes back every year" onChange={(recurs_annually) => setDeadline({ recurs_annually })} />
    </EditorSection>
  );
}

function SubmitSection({ draft, set }: { draft: ScholarshipDraft; set: Patch }) {
  const req = draft.requirements;
  const setReq = (patch: Partial<Requirements>) => set({ requirements: { ...req, ...patch } });
  return (
    <EditorSection id="ed-submit" title="What students submit">
      {req.essays.map((essay, index) => (
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-start gap-3" key={index}>
          <Field label={`Essay ${index + 1} prompt`}>
            {(id) => (
              <Textarea
                id={id}
                onChange={(e) => setReq({ essays: req.essays.map((x, i) => (i === index ? { ...x, prompt: e.target.value } : x)) })}
                rows={2}
                value={essay.prompt}
              />
            )}
          </Field>
          <Field label="Word limit">
            {(id) => (
              <NumberInput
                id={id}
                onChange={(words) => setReq({ essays: req.essays.map((x, i) => (i === index ? { ...x, words } : x)) })}
                placeholder="None"
                value={essay.words}
              />
            )}
          </Field>
          <Button
            aria-label={`Remove essay ${index + 1}`}
            className="mt-6"
            onClick={() => setReq({ essays: req.essays.filter((_, i) => i !== index) })}
            size="icon-xs"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button className="self-start" onClick={() => setReq({ essays: [...req.essays, { prompt: "", words: null }] })} size="sm" variant="outline">
        <Plus aria-hidden="true" />
        {req.essays.length ? "Add another essay" : "Add essay"}
      </Button>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field className="w-36" label="Recommendations">
          {(id) => <NumberInput id={id} onChange={(n) => setReq({ recommendations: Math.min(n ?? 0, 9) })} value={req.recommendations} />}
        </Field>
        <CheckRow checked={req.transcript} label="Transcript" onChange={(transcript) => setReq({ transcript })} />
        <CheckRow checked={req.financial_documents} label="Financial documents" onChange={(financial_documents) => setReq({ financial_documents })} />
        <CheckRow checked={req.interview} label="Interview" onChange={(interview) => setReq({ interview })} />
      </div>
    </EditorSection>
  );
}

function SourceSection({ draft, set }: { draft: ScholarshipDraft; set: Patch }) {
  const checked = draft.last_checked_on;
  const age = daysSince(checked);
  const hint = checked === null ? "Never checked" : age === 0 ? "Today" : `${formatLongDate(checked)} · ${age} days ago`;
  return (
    <EditorSection id="ed-source" title="Source">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Source link">
          {(id) => <Input id={id} inputMode="url" onChange={(e) => set({ source_url: e.target.value })} placeholder="The page you checked these details on" value={draft.source_url} />}
        </Field>
        <Field hint={hint} label="Last checked">
          {(id) => (
            <div className="flex items-center gap-2">
              <Input className="w-40" id={id} onChange={(e) => set({ last_checked_on: e.target.value || null })} type="date" value={checked ?? ""} />
              <Button disabled={checked === todayIso()} onClick={() => set({ last_checked_on: todayIso() })} size="sm" variant="outline">
                Checked today
              </Button>
            </div>
          )}
        </Field>
      </div>
    </EditorSection>
  );
}

export function EditorForm({ draft, set, others }: { draft: ScholarshipDraft; set: Patch; others: AdminScholarship[] }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]">
      <BasicsSection draft={draft} others={others} set={set} />
      <AwardSection draft={draft} set={set} />
      <DatesSection draft={draft} set={set} />
      <EditorSection id="ed-who" title="Who can apply">
        <EligibilityEditor
          onOtherChange={(other_eligibility) => set({ other_eligibility })}
          onRulesChange={(eligibility) => set({ eligibility })}
          other={draft.other_eligibility}
          rules={draft.eligibility}
        />
        <Field label="Fields of study" hint="Leave empty for any field. Used for the Field filter.">
          {(id) => <TagInput id={id} onChange={(fields) => set({ fields })} placeholder="e.g. Engineering" values={draft.fields} />}
        </Field>
      </EditorSection>
      <SubmitSection draft={draft} set={set} />
      <SourceSection draft={draft} set={set} />
    </div>
  );
}
