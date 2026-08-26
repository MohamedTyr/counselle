import {
  BookOpenText,
  FilePenLine,
  Link2,
  Plus,
  Sparkles,
  Unlink,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import {
  useArchiveEssayPromptDraft,
  useConvertEssayPromptDraft,
  useCreateEssay,
  useCreateEssayPromptDraft,
  useRestoreEssayPromptDraft,
  useUpdateEssay,
} from "@/api/workspace/hooks";
import type {
  ApplicationDetail,
  EssayPromptDraft,
  EssaySummary,
  SchoolEssayPrompt,
  SchoolPromptGroup,
} from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UndoToast } from "@/components/undo-toast";
import { PromptDraftRow } from "@/features/essays/PromptDraftRow";
import { Provenance } from "@/features/schools/school-workspace-fields";
import {
  applicabilityLabels,
  audienceDescription,
  cycleLabel,
} from "@/features/schools/school-workspace-format";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";

/* Extracted verbatim from SchoolWorkspace.tsx (the 800-line limit). */

function PromptRow({
  applicationId,
  essay,
  group,
  prompt,
  unlinkedEssays,
}: {
  applicationId: string;
  essay?: EssaySummary;
  group?: SchoolPromptGroup;
  prompt: SchoolEssayPrompt;
  unlinkedEssays: EssaySummary[];
}) {
  const navigate = useNavigate();
  const createEssay = useCreateEssay();
  const updateEssay = useUpdateEssay();
  const [selectedEssay, setSelectedEssay] = useState("");
  const progress = prompt.word_limit
    ? Math.min(essay?.word_count ?? 0, prompt.word_limit)
    : 0;
  async function startWriting() {
    const created = await createEssay.mutateAsync({
      application_id: applicationId,
      essay_type: "Supplement",
      prompt: prompt.prompt,
      prompt_ref: prompt.id,
      status: "Not started",
      title: `Supplement ${prompt.ordinal}`,
      word_limit: prompt.word_limit,
    });
    void navigate(`/app/essays/${created.id}`);
  }
  async function attach() {
    if (!selectedEssay) return;
    await updateEssay.mutateAsync({
      id: selectedEssay,
      patch: { application_id: applicationId, prompt_ref: prompt.id },
    });
    setSelectedEssay("");
  }
  return (
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Prompt {prompt.ordinal}</Badge>
            <Badge variant="secondary">
              {applicabilityLabels[prompt.applicability]}
            </Badge>
            {group ? (
              <span className="text-xs text-muted-foreground">
                {group.label} · choose {group.choice_min}
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-6">{prompt.prompt}</p>
          {prompt.applicability === "conditional" ? (
            <p className="text-sm text-warning">
              Verify whether this prompt applies to you
              {audienceDescription(prompt.audience)
                ? `: ${audienceDescription(prompt.audience)}`
                : "."}
            </p>
          ) : null}
          <Provenance provenance={prompt.provenance} />
          {group ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Choice-group source
              </span>
              <Provenance provenance={group.provenance} />
            </div>
          ) : null}
        </div>
        {essay ? (
          <div className="flex shrink-0 gap-2">
            <Badge variant="secondary">{essay.status}</Badge>
            <Button
              onClick={() => void navigate(`/app/essays/${essay.id}`)}
              size="sm"
            >
              Open
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`Detach ${essay.title} as a personal copy`}
                  onClick={() =>
                    updateEssay.mutate({
                      id: essay.id,
                      patch: { prompt_ref: null },
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  <Unlink data-icon="inline-start" />
                  Detach as personal copy
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                The current prompt text stays with your essay, but catalog
                updates and source provenance will no longer apply.
              </TooltipContent>
            </Tooltip>
          </div>
        ) : prompt.applicability === "not_required" ? (
          <p className="text-sm text-muted-foreground">
            No draft action because this prompt is published as not required.
          </p>
        ) : (
          <Button
            disabled={createEssay.isPending}
            onClick={() => void startWriting()}
            size="sm"
          >
            <FilePenLine data-icon="inline-start" />
            Start writing
          </Button>
        )}
      </div>
      {essay ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{essay.title}</span>
            <span className="tabular-nums">
              {essay.word_count}
              {prompt.word_limit ? ` / ${prompt.word_limit}` : " words"}
            </span>
          </div>
          {prompt.word_limit ? (
            <Meter
              aria-label={`${essay.title} word progress: ${essay.word_count} of ${prompt.word_limit}`}
              max={prompt.word_limit}
              value={progress}
            >
              <MeterTrack className="h-1.5 rounded-full">
                <MeterIndicator />
              </MeterTrack>
            </Meter>
          ) : null}
        </div>
      ) : prompt.applicability !== "not_required" &&
        unlinkedEssays.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            onValueChange={(value) => value && setSelectedEssay(value)}
            value={selectedEssay}
          >
            <SelectTrigger
              aria-label={`Use existing essay for prompt ${prompt.ordinal}`}
              size="sm"
            >
              <SelectValue placeholder="Use existing essay" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {unlinkedEssays.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
          <Button
            disabled={!selectedEssay || updateEssay.isPending}
            onClick={() => void attach()}
            size="sm"
            variant="outline"
          >
            <Link2 data-icon="inline-start" />
            Attach
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PromptDraftsCard({ detail }: { detail: ApplicationDetail }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [promptText, setPromptText] = useState("");
  const [wordLimitText, setWordLimitText] = useState("");
  const createDraft = useCreateEssayPromptDraft();
  const convertDraft = useConvertEssayPromptDraft();
  const archiveDraft = useArchiveEssayPromptDraft();
  const restoreDraft = useRestoreEssayPromptDraft();
  const draftUndo = useUndoableDelete<EssayPromptDraft>({
    archiveMutation: archiveDraft,
    getLabel: () => "Prompt",
    restoreMutation: restoreDraft,
  });

  async function submit() {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    const wordLimit = wordLimitText.trim()
      ? Number.parseInt(wordLimitText, 10)
      : null;
    await createDraft.mutateAsync({
      application_id: detail.application.id,
      prompt: trimmed,
      word_limit: wordLimit && wordLimit > 0 ? wordLimit : null,
    });
    setPromptText("");
    setWordLimitText("");
  }

  async function startWriting(draft: EssayPromptDraft) {
    const created = await convertDraft.mutateAsync({
      id: draft.id,
      title: `${detail.application.school_name} supplement`,
    });
    void navigate(`/app/essays/${created.id}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts you're tracking</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="flex-1">
            <InputGroupInput
              aria-label="Add a prompt you're tracking"
              onChange={(event) => setPromptText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="Add a prompt you know about — you can turn it into a full essay later"
              value={promptText}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                disabled={!promptText.trim() || createDraft.isPending}
                onClick={() => void submit()}
              >
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Input
            aria-label="Word limit (optional)"
            className="sm:w-32"
            min={1}
            onChange={(event) => setWordLimitText(event.currentTarget.value)}
            placeholder="Word limit"
            type="number"
            value={wordLimitText}
          />
        </div>
        {detail.prompt_drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tracked prompts yet. Add one above, or start writing directly
            from a catalog prompt above.
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {detail.prompt_drafts.map((draft) => (
              <PromptDraftRow
                draft={{
                  ...draft,
                  school_name: detail.application.school_name,
                  school_city: detail.application.school_city,
                  school_state: detail.application.school_state,
                  school_website_url: detail.application.website_url,
                }}
                isConverting={convertDraft.isPending}
                key={draft.id}
                onConvert={() => void startWriting(draft)}
                onDelete={() => draftUndo.archive(draft)}
              />
            ))}
          </div>
        )}
      </CardContent>
      <UndoToast
        onDismiss={draftUndo.clearPending}
        onUndo={draftUndo.undo}
        pending={draftUndo.pending}
        reduceMotion={!!reduceMotion}
      />
    </Card>
  );
}

export function SchoolEssaysSection({ detail }: { detail: ApplicationDetail }) {
  const navigate = useNavigate();
  const createEssay = useCreateEssay();
  const updateEssay = useUpdateEssay();
  const prompts =
    detail.reference.status === "loaded" ? detail.reference.prompts : [];
  const promptGroups = new Map(
    (detail.reference.status === "loaded"
      ? detail.reference.prompt_groups
      : []
    ).map((group) => [group.id, group]),
  );
  const schoolEssays = detail.essays.filter(
    (essay) => essay.essay_type !== "Personal statement",
  );
  const catalogEssays = schoolEssays.filter((essay) => essay.prompt_ref);
  const addedEssays = schoolEssays.filter((essay) => !essay.prompt_ref);
  const publishedPromptIds = new Set(prompts.map((prompt) => prompt.id));
  const unavailablePromptEssays = catalogEssays.filter(
    (essay) => essay.prompt_ref && !publishedPromptIds.has(essay.prompt_ref),
  );
  const suggestedRequest = `Find the official ${cycleLabel(detail.application.cycle_year)} supplemental essay prompts for ${detail.application.school_name}. Cite each source and clearly mark anything uncertain.`;
  async function copySuggestedRequest() {
    try {
      await navigator.clipboard.writeText(suggestedRequest);
      toast.success("Research request copied");
    } catch {
      toast.error("Could not copy the research request");
    }
  }
  async function addEssay() {
    const created = await createEssay.mutateAsync({
      application_id: detail.application.id,
      essay_type: "Supplement",
      status: "Not started",
      title: `${detail.application.school_name} supplement`,
    });
    void navigate(`/app/essays/${created.id}`);
  }
  return (
    <section className="flex scroll-mt-20 flex-col gap-5" id="essays">
      <div>
        <h2 className="font-heading text-xl font-medium">Essays</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Catalog prompts stay separate from drafts you add yourself.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>School prompts</CardTitle>
        </CardHeader>
        <CardContent>
          {!detail.application.cycle_year ||
          detail.reference.status === "cycle_required" ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenText />
                </EmptyMedia>
                <EmptyTitle>Confirm the application cycle first</EmptyTitle>
                <EmptyDescription>
                  Catalog facts are never loaded against an unknown cycle.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : prompts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookOpenText />
                </EmptyMedia>
                <EmptyTitle>
                  {detail.reference.populated
                    ? "No published essay prompts for this cycle"
                    : `No catalog data for the ${cycleLabel(detail.application.cycle_year)} application cycle`}
                </EmptyTitle>
                <EmptyDescription>
                  {detail.reference.populated
                    ? `The catalog contains other ${detail.application.school_name} facts, but no published essay prompts.`
                    : `We do not have any published ${detail.application.school_name} catalog facts for this cycle.`}{" "}
                  Nothing is inferred or fabricated.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => void addEssay()}>
                  <Plus data-icon="inline-start" />
                  Add an essay
                </Button>
                <Button
                  onClick={() => void copySuggestedRequest()}
                  variant="outline"
                >
                  Copy research request
                </Button>
                <Button render={<Link to="/app/ai" />} variant="outline">
                  <Sparkles data-icon="inline-start" />
                  Open Counselle
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            prompts.map((prompt, index) => (
              <div key={prompt.id}>
                {index > 0 ? <Separator /> : null}
                <PromptRow
                  applicationId={detail.application.id}
                  essay={catalogEssays.find(
                    (essay) => essay.prompt_ref === prompt.id,
                  )}
                  group={
                    prompt.group_id
                      ? promptGroups.get(prompt.group_id)
                      : undefined
                  }
                  prompt={prompt}
                  unlinkedEssays={addedEssays}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <PromptDraftsCard detail={detail} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Added by you</CardTitle>
            <Button
              disabled={createEssay.isPending}
              onClick={() => void addEssay()}
              size="sm"
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              Add essay
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {addedEssays.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unlinked school essays yet.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {addedEssays.map((essay) => (
                <div
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  key={essay.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {essay.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {essay.word_count} words · {essay.status}
                    </p>
                  </div>
                  <Button
                    render={<Link to={`/app/essays/${essay.id}`} />}
                    size="sm"
                    variant="ghost"
                  >
                    Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {unavailablePromptEssays.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historical or unavailable prompts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              These drafts remain linked to prompt records that are no longer in
              the published catalog. Your writing is preserved.
            </p>
            <div className="flex flex-col divide-y">
              {unavailablePromptEssays.map((essay) => (
                <div
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  key={essay.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {essay.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {essay.status} · Prompt unavailable
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      render={<Link to={`/app/essays/${essay.id}`} />}
                      size="sm"
                      variant="outline"
                    >
                      Open
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={`Detach ${essay.title} as a personal copy`}
                          onClick={() =>
                            updateEssay.mutate({
                              id: essay.id,
                              patch: { prompt_ref: null },
                            })
                          }
                          size="sm"
                          variant="ghost"
                        >
                          <Unlink data-icon="inline-start" />
                          Detach as personal copy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        The current prompt text stays with your essay, but
                        catalog updates and source provenance will no longer
                        apply.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
