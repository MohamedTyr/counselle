import { QueryClientProvider } from "@tanstack/react-query";
import { EditorContent } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState, type ReactElement } from "react";
import { MemoryRouter } from "react-router";

import { useEssay } from "@/api/workspace/hooks";
import { workspaceKeys } from "@/api/workspace/keys";
import type { Essay as ApiEssay, EssaySummary } from "@/api/workspace/types";
import { essayFromApi } from "@/domain/essay";
import { EssayEditorPage } from "@/features/essays/EssayEditorRoute";
import { EssaysPage } from "@/features/essays/EssaysRoute";
import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import type { EssayEditorUpdate } from "@/features/essays/useEssayEditor";
import { useEssayEditor } from "@/features/essays/useEssayEditor";
import {
  createTestQueryClient,
  createWorkspaceFetchPreset,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
  workspaceEssayFixture,
  workspaceReferenceFixture,
} from "@/test/render-app";

function tiptapDoc(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function tiptapText(content: ApiEssay["content"] | undefined) {
  const blocks = content?.content;

  if (!Array.isArray(blocks)) {
    return "";
  }

  return blocks
    .flatMap((block) =>
      Array.isArray(block?.content)
        ? block.content.map((node) => node?.text).filter(Boolean)
        : [],
    )
    .join("");
}

const commonEssay: EssaySummary = {
  ...workspaceEssayFixture,
  application_id: null,
  deadline: null,
  essay_type: "Personal statement",
  id: "common-app-main",
  preview: "A specific scene.",
  school_city: null,
  school_name: null,
  school_state: null,
  title: "Common App Personal Statement",
  word_count: 3,
  word_limit: 650,
};

const stanfordEssay: EssaySummary = {
  ...workspaceEssayFixture,
  deadline: "2026-07-12",
  id: "stanford-roommate",
  preview: "A roommate line.",
  school_city: "Stanford",
  school_name: "Stanford University",
  school_state: "CA",
  status: "Needs review",
  suggestion_count: 3,
  title: "Stanford Roommate Note",
  word_count: 216,
  word_limit: 250,
};

const commonEssayDetail: ApiEssay = {
  ...commonEssay,
  content: tiptapDoc("A specific scene."),
  comments: [],
  suggestions: [],
};

const stanfordEssayDetail: ApiEssay = {
  ...stanfordEssay,
  content: tiptapDoc("A roommate line."),
  comments: [],
  suggestions: [],
};

function renderWithQuery(
  ui: ReactElement,
  essays: EssaySummary[] = [commonEssay, stanfordEssay],
  essayDetails: ApiEssay[] = [commonEssayDetail, stanfordEssayDetail],
  fetchHandler: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response> = createWorkspaceFetchPreset({
    essayDetails,
    essays,
  }),
) {
  const queryClient = createTestQueryClient();
  vi.stubGlobal("fetch", vi.fn(fetchHandler));

  return {
    queryClient,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

function AutosaveHarness() {
  const autosave = useEssayAutosave("stanford-roommate");

  return (
    <div>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("First draft"), 2)}
        type="button"
      >
        Queue draft A
      </button>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("Second draft"), 2)}
        type="button"
      >
        Queue draft B
      </button>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("Autosaved text"), 2)}
        type="button"
      >
        Queue save
      </button>
      <button onClick={autosave.flush} type="button">
        Flush save
      </button>
      <span data-testid="autosave-dirty">{String(autosave.isDirty)}</span>
      <span data-testid="autosave-state">{autosave.saveState}</span>
    </div>
  );
}

function CachedAutosaveHarness() {
  const essayQuery = useEssay("stanford-roommate");
  const autosave = useEssayAutosave("stanford-roommate");

  return (
    <div>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("Autosaved text"), 2)}
        type="button"
      >
        Queue save
      </button>
      <span data-testid="autosave-dirty">{String(autosave.isDirty)}</span>
      <span data-testid="autosave-state">{autosave.saveState}</span>
      <span data-testid="cached-essay-content">
        {tiptapText(essayQuery.data?.content)}
      </span>
    </div>
  );
}

function CachedAutosaveRaceHarness() {
  const essayQuery = useEssay("stanford-roommate");
  const autosave = useEssayAutosave(
    "stanford-roommate",
    essayQuery.data
      ? {
          content: essayQuery.data.content,
          wordCount: essayQuery.data.word_count,
        }
      : undefined,
  );

  return (
    <div>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("First draft"), 2)}
        type="button"
      >
        Queue draft A
      </button>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("Second draft"), 2)}
        type="button"
      >
        Queue draft B
      </button>
      <button onClick={autosave.flush} type="button">
        Flush save
      </button>
      <span data-testid="autosave-dirty">{String(autosave.isDirty)}</span>
      <span data-testid="autosave-state">{autosave.saveState}</span>
      <span data-testid="cached-essay-content">
        {tiptapText(essayQuery.data?.content)}
      </span>
    </div>
  );
}

function BaselineAutosaveRaceHarness() {
  const essayQuery = useEssay("stanford-roommate");
  const savedDraft = essayQuery.data
    ? {
        content: essayQuery.data.content,
        wordCount: essayQuery.data.word_count,
      }
    : undefined;
  const autosave = useEssayAutosave("stanford-roommate", savedDraft);

  return (
    <div>
      <button
        onClick={() => autosave.queueSave(tiptapDoc("Second draft"), 2)}
        type="button"
      >
        Queue draft B
      </button>
      <button
        disabled={!savedDraft}
        onClick={() =>
          savedDraft &&
          autosave.queueSave(savedDraft.content, savedDraft.wordCount)
        }
        type="button"
      >
        Revert baseline
      </button>
      <button onClick={autosave.flush} type="button">
        Flush save
      </button>
      <span data-testid="autosave-dirty">{String(autosave.isDirty)}</span>
      <span data-testid="autosave-state">{autosave.saveState}</span>
      <span data-testid="cached-essay-content">
        {tiptapText(essayQuery.data?.content)}
      </span>
    </div>
  );
}

function EditorDirtySyncHarness({ essay }: { essay: ApiEssay }) {
  const [wordCount, setWordCount] = useState(essay.word_count);
  const autosave = useEssayAutosave(essay.id, {
    content: essay.content,
    wordCount: essay.word_count,
  });

  function handleUpdate(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.queueSave(update.content, update.wordCount);
  }

  function handleBlur(update: EssayEditorUpdate) {
    setWordCount(update.wordCount);
    autosave.flush();
  }

  const { editor } = useEssayEditor({
    content: essay.content,
    onBlur: handleBlur,
    onUpdate: handleUpdate,
    syncContent: !autosave.isDirty,
  });

  return (
    <div>
      <button
        onClick={() =>
          editor?.commands.setContent(tiptapDoc("Local dirty draft"))
        }
        type="button"
      >
        Edit through Tiptap
      </button>
      <button
        onClick={() => editor?.commands.setContent(essay.content)}
        type="button"
      >
        Revert through Tiptap
      </button>
      <span data-testid="editor-word-count">{wordCount}</span>
      <span data-testid="autosave-dirty">{String(autosave.isDirty)}</span>
      <span data-testid="autosave-state">{autosave.saveState}</span>
      <EditorContent editor={editor} />
    </div>
  );
}

describe("EssaysPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the shared page header and controls from the API list", async () => {
    renderWithQuery(<EssaysPage />);

    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New essay" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("searchbox", { name: "Search essays" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All2/ })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Needs review1/ }),
    ).toBeInTheDocument();
  });

  it("filters cards by search query and tab", async () => {
    const user = userEvent.setup();
    renderWithQuery(<EssaysPage />);

    await screen.findAllByText("Common App Personal Statement");
    await user.type(
      screen.getByRole("searchbox", { name: "Search essays" }),
      "stanford",
    );

    expect(
      screen.getAllByText("Stanford Roommate Note").length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("Common App Personal Statement")).toHaveLength(
      0,
    );

    await user.clear(screen.getByRole("searchbox", { name: "Search essays" }));
    await user.click(screen.getByRole("tab", { name: /Personal statement/ }));

    expect(
      screen.getAllByText("Common App Personal Statement").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText("Stanford Roommate Note"),
    ).not.toBeInTheDocument();
  });

  it("shows distinct first-run and zero-filter-match empty states", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    const firstRun = renderWithQuery(
      <EssaysPage onOpenEssay={onOpenEssay} />,
      [],
    );

    expect(await screen.findByText("No essays yet")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Start personal statement" }),
    );
    await user.click(screen.getByRole("button", { name: "Create essay" }));

    await waitFor(() =>
      expect(onOpenEssay).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: null,
          title: "Personal statement",
          type: "Personal statement",
        }),
      ),
    );

    firstRun.unmount();
    renderWithQuery(<EssaysPage />);
    await screen.findAllByText("Stanford Roommate Note");
    await user.type(
      screen.getByRole("searchbox", { name: "Search essays" }),
      "missing",
    );

    expect(screen.getByText("No essays found")).toBeInTheDocument();
  });

  it("creates a school essay linked to the selected catalog prompt", async () => {
    const user = userEvent.setup();
    const promptId = "60000000-0000-4000-8000-000000000001";
    const requestBodies: Record<string, unknown>[] = [];
    const preset = createWorkspaceFetchPreset({
      essayDetails: [],
      essays: [],
      reference: {
        ...workspaceReferenceFixture,
        populated: true,
        prompts: [
          {
            id: promptId,
            school_unitid: workspaceApplicationFixture.school_unitid,
            cycle_year: 2027,
            ordinal: 1,
            prompt: "Describe an experience that shaped your perspective.",
            word_limit: 250,
            applicability: "required",
            audience: {},
            provenance: {
              source: "Admissions",
              source_url: "https://example.edu/admissions",
              verified_at: "2026-07-01",
            },
          },
        ],
      },
    });
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/essays") && init?.method === "POST") {
        requestBodies.push(JSON.parse(String(init.body ?? "{}")));
      }
      return preset(input, init);
    };

    const queryClient = createTestQueryClient();
    vi.stubGlobal("fetch", vi.fn(fetchHandler));
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EssaysPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "New essay" }));
    await user.click(screen.getByRole("combobox", { name: "School link" }));
    await user.click(
      await screen.findByRole("option", { name: /Harvard University/ }),
    );

    await screen.findByText(/keeps this essay connected/);
    await user.click(screen.getByRole("combobox", { name: "Essay prompt" }));
    await user.click(
      await screen.findByRole("option", {
        name: /Prompt 1.*Required.*250 words.*Describe an experience/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Create essay" }));

    await waitFor(() =>
      expect(requestBodies).toContainEqual(
        expect.objectContaining({
          application_id: workspaceApplicationFixture.id,
          prompt_ref: promptId,
        }),
      ),
    );
    expect(requestBodies[0]).not.toHaveProperty("prompt");
    expect(requestBodies[0]).not.toHaveProperty("word_limit");
  });

  it("opens an essay from the primary card action", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    renderWithQuery(<EssaysPage onOpenEssay={onOpenEssay} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Open Stanford Roommate Note",
      }),
    );

    expect(onOpenEssay).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stanford-roommate" }),
    );
  });

  it("duplicates and marks essays ready through real menu actions", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    renderWithQuery(<EssaysPage onOpenEssay={onOpenEssay} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() =>
      expect(onOpenEssay).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Stanford Roommate Note copy" }),
      ),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Ready" }));

    const cards = await screen.findAllByText("Stanford Roommate Note");
    const originalCard = cards[0]!.closest("article");

    expect(originalCard).not.toBeNull();
    await waitFor(() =>
      expect(
        within(originalCard as HTMLElement).getByText("Ready"),
      ).toBeInTheDocument(),
    );
  });

  it("archives essays with undo backed by restore", async () => {
    const user = userEvent.setup();
    renderWithQuery(<EssaysPage />);

    await user.click(
      await screen.findByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(
      await screen.findByText("Stanford Roommate Note deleted"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stanford Roommate Note"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(
      (await screen.findAllByText("Stanford Roommate Note")).length,
    ).toBeGreaterThan(0);
  });

  it("shows essay undo only after archive succeeds", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const preset = createWorkspaceFetchPreset({
      essayDetails: [commonEssayDetail, stanfordEssayDetail],
      essays: [commonEssay, stanfordEssay],
    });
    let resolveDelete: (() => void) | undefined;

    renderWithQuery(
      <EssaysPage />,
      [commonEssay, stanfordEssay],
      [commonEssayDetail, stanfordEssayDetail],
      (input, init) => {
        const url = String(input);

        if (
          url.includes("/v1/essays/stanford-roommate") &&
          init?.method === "DELETE"
        ) {
          calls.push("delete-start");
          return new Promise<Response>((resolve) => {
            resolveDelete = () => {
              calls.push("delete-resolve");
              resolve(preset(input, init));
            };
          });
        }

        if (url.endsWith("/restore")) {
          calls.push(
            calls.includes("delete-resolve")
              ? "restore-after-delete"
              : "restore-before-delete",
          );
        }

        return preset(input, init);
      },
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => expect(calls).toContain("delete-start"));
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
    expect(calls).not.toContain("restore-before-delete");

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
    });

    expect(
      await screen.findByText("Stanford Roommate Note deleted"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(calls).toContain("restore-after-delete"));
    expect(calls).not.toContain("restore-before-delete");
  });
});

describe("EssayEditorPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderEditor(
    essay: ApiEssay = stanfordEssayDetail,
    fetchHandler: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Response = vi.fn(() => jsonResponse(essay)),
  ) {
    const queryClient = createTestQueryClient();
    vi.stubGlobal("fetch", fetchHandler);

    return {
      fetchHandler,
      ...render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <EssayEditorPage essay={essayFromApi(essay)} onBack={vi.fn()} />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
    };
  }

  it("renders selected essay editor chrome and prompt menu", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(
      await screen.findByRole("heading", { name: "Stanford Roommate Note" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.textContent === "216/250 words",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Prompt/ }));

    expect(
      screen.getByText(/Stanford University supplement/),
    ).toBeInTheDocument();
  });

  function renderAutosaveHarness(
    fetchHandler = vi.fn(() => jsonResponse(stanfordEssayDetail)),
  ) {
    const queryClient = createTestQueryClient();
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <AutosaveHarness />
      </QueryClientProvider>,
    );

    return fetchHandler;
  }

  it("autosaves JSON after the debounce", async () => {
    vi.useFakeTimers();
    const fetchHandler = renderAutosaveHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      await Promise.resolve();
    });

    expect(fetchHandler).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1499);
      await Promise.resolve();
    });
    expect(fetchHandler).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchHandler).toHaveBeenCalledWith(
      "/v1/essays/stanford-roommate",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, init] = fetchHandler.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      content: tiptapDoc("Autosaved text"),
    });
  });

  it("flushes autosave immediately on blur", async () => {
    vi.useFakeTimers();
    const fetchHandler = renderAutosaveHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchHandler).toHaveBeenCalledWith(
      "/v1/essays/stanford-roommate",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("deduplicates repeated direct flushes for the same draft", async () => {
    vi.useFakeTimers();
    const firstSave = deferredResponse();
    const secondSave = deferredResponse();
    let patchCount = 0;
    const fetchHandler = renderAutosaveHarness(
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : secondSave.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    const firstDraftPatches = fetchHandler.mock.calls.filter(
      ([, init]) =>
        init?.method === "PATCH" &&
        JSON.parse(String(init.body)).content.content[0]?.content[0]?.text ===
          "Autosaved text",
    );
    expect(firstDraftPatches).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    const directPatches = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH" && init.keepalive !== true,
    );
    expect(directPatches).toHaveLength(1);

    await act(async () => {
      firstSave.resolve(
        jsonResponse({
          ...stanfordEssayDetail,
          content: tiptapDoc("Autosaved text"),
          word_count: 2,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const serializedDirectPatches = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH" && init.keepalive !== true,
    );
    expect(serializedDirectPatches).toHaveLength(2);
    expect(JSON.parse(String(serializedDirectPatches[1]?.[1]?.body))).toEqual({
      content: tiptapDoc("Second draft"),
    });

    await act(async () => {
      secondSave.resolve(
        jsonResponse({
          ...stanfordEssayDetail,
          content: tiptapDoc("Second draft"),
          word_count: 2,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("marks autosave clean when content returns to the last saved draft", async () => {
    vi.useFakeTimers();
    const savedFirstDraft: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("First draft"),
      preview: "First draft",
      word_count: 2,
    };
    const fetchHandler = renderAutosaveHarness(
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          return jsonResponse(savedFirstDraft);
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft A" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      await Promise.resolve();
    });
    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saving");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft A" }));
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    const patches = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patches).toHaveLength(1);
    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
  });

  it.each([
    ["pagehide", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "visibility hidden",
      () => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("flushes autosave with keepalive on %s", async (_name, dispatchUnload) => {
    vi.useFakeTimers();
    const fetchHandler = renderAutosaveHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      dispatchUnload();
      await Promise.resolve();
    });

    const [, init] = fetchHandler.mock.calls[0]!;
    expect(fetchHandler).toHaveBeenCalledWith(
      "/v1/essays/stanford-roommate",
      expect.objectContaining({
        keepalive: true,
        method: "PATCH",
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      content: tiptapDoc("Autosaved text"),
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("deduplicates keepalive autosave across hidden then pagehide", async () => {
    vi.useFakeTimers();
    const fetchHandler = renderAutosaveHarness();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    const keepaliveCalls = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH" && init.keepalive === true,
    );
    expect(keepaliveCalls).toHaveLength(1);
    expect(JSON.parse(String(keepaliveCalls[0]?.[1]?.body))).toEqual({
      content: tiptapDoc("Autosaved text"),
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("does not send keepalive duplicate while a direct save is in flight for the same draft", async () => {
    vi.useFakeTimers();
    const directSave = deferredResponse();
    const fetchHandler = renderAutosaveHarness(
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          return directSave.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    const patchCalls = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]?.[1]?.keepalive).not.toBe(true);
    expect(JSON.parse(String(patchCalls[0]?.[1]?.body))).toEqual({
      content: tiptapDoc("Autosaved text"),
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("keeps query cache in sync after a successful keepalive save", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [stanfordEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      stanfordEssayDetail,
    );

    const savedEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Autosaved text"),
      preview: "Autosaved text",
      updated_at: "2026-07-06T12:30:00Z",
      word_count: 2,
    };
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/v1/essays/stanford-roommate")) {
          return jsonResponse(
            init?.method === "PATCH" ? savedEssay : stanfordEssayDetail,
          );
        }

        return jsonResponse([]);
      },
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <CachedAutosaveHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "A roommate line.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
      "Autosaved text",
    );
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Autosaved text");
    expect(
      queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list())?.[0]
        ?.word_count,
    ).toBe(2);
  });

  it("keeps query cache in sync after a successful unmount flush", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [stanfordEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      stanfordEssayDetail,
    );

    const save = deferredResponse();
    const savedEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Autosaved text"),
      preview: "Autosaved text",
      updated_at: "2026-07-06T12:30:00Z",
      word_count: 2,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          return save.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <CachedAutosaveHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "A roommate line.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      unmount();
      await Promise.resolve();
    });

    await act(async () => {
      save.resolve(jsonResponse(savedEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        tiptapText(
          queryClient.getQueryData<ApiEssay>(
            workspaceKeys.essays.detail("stanford-roommate"),
          )?.content,
        ),
      ).toBe("Autosaved text"),
    );
    expect(
      queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list())?.[0]
        ?.word_count,
    ).toBe(2);
  });

  it("marks essay caches stale when an unmount flush fails", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(workspaceKeys.essays.list(), [stanfordEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      stanfordEssayDetail,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const save = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          return save.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <CachedAutosaveHarness />
      </QueryClientProvider>,
    );

    await screen.findByTestId("cached-essay-content");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      unmount();
      await Promise.resolve();
    });

    await act(async () => {
      save.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.essays.detail("stanford-roommate"),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.essays.list(),
    });
  });

  it("sends a queued newer draft after an earlier direct autosave fails", async () => {
    const firstSave = deferredResponse();
    const secondSave = deferredResponse();
    const savedEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Second draft"),
      preview: "Second draft",
      word_count: 2,
    };
    let patchCount = 0;
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : secondSave.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(workspaceKeys.essays.list(), [stanfordEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      stanfordEssayDetail,
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <AutosaveHarness />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft A" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    expect(fetchHandler.mock.calls).toHaveLength(1);

    await act(async () => {
      firstSave.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchHandler.mock.calls).toHaveLength(2));

    await act(async () => {
      secondSave.resolve(jsonResponse(savedEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Second draft");
  });

  it("serializes direct autosaves so a queued newer draft wins after refetch", async () => {
    const firstSave = deferredResponse();
    const secondSave = deferredResponse();
    const staleEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("First draft"),
      preview: "First draft",
      updated_at: "2026-07-06T12:00:00Z",
      word_count: 2,
    };
    const savedEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Second draft"),
      preview: "Second draft",
      updated_at: "2026-07-06T12:01:00Z",
      word_count: 2,
    };
    let serverEssay = stanfordEssayDetail;
    let patchCount = 0;
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : secondSave.promise;
        }

        return jsonResponse(serverEssay);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [stanfordEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      stanfordEssayDetail,
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <CachedAutosaveRaceHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "A roommate line.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft A" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    expect(fetchHandler.mock.calls).toHaveLength(1);

    await act(async () => {
      serverEssay = staleEssay;
      firstSave.resolve(jsonResponse(staleEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchHandler.mock.calls).toHaveLength(2));
    expect(JSON.parse(String(fetchHandler.mock.calls[1]?.[1]?.body))).toEqual({
      content: tiptapDoc("Second draft"),
    });

    await act(async () => {
      serverEssay = savedEssay;
      secondSave.resolve(jsonResponse(savedEssay));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
        "Second draft",
      ),
    );

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceKeys.essays.detail("stanford-roommate"),
      });
    });

    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
      "Second draft",
    );
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Second draft");
    expect(
      queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list())?.[0]
        ?.preview,
    ).toBe("Second draft");
  });

  it("sends a compensating baseline save after a conflicting in-flight draft resolves", async () => {
    const firstSave = deferredResponse();
    const baselineSave = deferredResponse();
    const initialEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Baseline draft"),
      preview: "Baseline draft",
      word_count: 2,
    };
    const staleEssay: ApiEssay = {
      ...initialEssay,
      content: tiptapDoc("Second draft"),
      preview: "Second draft",
    };
    let patchCount = 0;
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : baselineSave.promise;
        }

        return jsonResponse(initialEssay);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [initialEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      initialEssay,
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <BaselineAutosaveRaceHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    expect(fetchHandler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchHandler.mock.calls[0]?.[1]?.body))).toEqual({
      content: tiptapDoc("Second draft"),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revert baseline" }));
      await Promise.resolve();
    });

    expect(fetchHandler).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saving");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("true");

    await act(async () => {
      firstSave.resolve(jsonResponse(staleEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchHandler).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchHandler.mock.calls[1]?.[1]?.body))).toEqual({
      content: tiptapDoc("Baseline draft"),
    });
    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saving");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("true");

    await act(async () => {
      baselineSave.resolve(jsonResponse(initialEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Baseline draft");
  });

  it("sends final baseline with keepalive on pagehide despite a conflicting in-flight draft", async () => {
    const firstSave = deferredResponse();
    const baselineSave = deferredResponse();
    const initialEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Baseline draft"),
      preview: "Baseline draft",
      word_count: 2,
    };
    const staleEssay: ApiEssay = {
      ...initialEssay,
      content: tiptapDoc("Second draft"),
      preview: "Second draft",
    };
    let patchCount = 0;
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : baselineSave.promise;
        }

        return jsonResponse(initialEssay);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [initialEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      initialEssay,
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <BaselineAutosaveRaceHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revert baseline" }));
      await Promise.resolve();
    });

    expect(fetchHandler).toHaveBeenCalledTimes(1);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    const patchCalls = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    const keepaliveCalls = patchCalls.filter(
      ([, init]) => init?.keepalive === true,
    );
    expect(patchCalls).toHaveLength(2);
    expect(keepaliveCalls).toHaveLength(1);
    expect(JSON.parse(String(keepaliveCalls[0]?.[1]?.body))).toEqual({
      content: tiptapDoc("Baseline draft"),
    });

    await act(async () => {
      firstSave.resolve(jsonResponse(staleEssay));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchHandler.mock.calls).toHaveLength(2);

    await act(async () => {
      baselineSave.resolve(jsonResponse(initialEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Baseline draft");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("does not replay a queued baseline direct save after keepalive wins the race", async () => {
    const directSave = deferredResponse();
    const keepaliveSave = deferredResponse();
    const initialEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Baseline draft"),
      preview: "Baseline draft",
      word_count: 2,
    };
    const staleEssay: ApiEssay = {
      ...initialEssay,
      content: tiptapDoc("Second draft"),
      preview: "Second draft",
    };
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          if (init.keepalive === true) {
            return keepaliveSave.promise;
          }

          return directSave.promise;
        }

        return jsonResponse(initialEssay);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [initialEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      initialEssay,
    );
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={queryClient}>
        <BaselineAutosaveRaceHarness />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revert baseline" }));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    const patchCallsBeforeResolve = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCallsBeforeResolve).toHaveLength(2);
    expect(patchCallsBeforeResolve[0]?.[1]?.keepalive).not.toBe(true);
    expect(JSON.parse(String(patchCallsBeforeResolve[0]?.[1]?.body))).toEqual({
      content: tiptapDoc("Second draft"),
    });
    expect(patchCallsBeforeResolve[1]?.[1]?.keepalive).toBe(true);
    expect(JSON.parse(String(patchCallsBeforeResolve[1]?.[1]?.body))).toEqual({
      content: tiptapDoc("Baseline draft"),
    });

    await act(async () => {
      keepaliveSave.resolve(jsonResponse(initialEssay));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      directSave.resolve(jsonResponse(staleEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCallsAfterResolve = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCallsAfterResolve).toHaveLength(2);
    expect(
      patchCallsAfterResolve.filter(([, init]) => init?.keepalive === true),
    ).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(screen.getByTestId("cached-essay-content")).toHaveTextContent(
      "Baseline draft",
    );
    expect(
      tiptapText(
        queryClient.getQueryData<ApiEssay>(
          workspaceKeys.essays.detail("stanford-roommate"),
        )?.content,
      ),
    ).toBe("Baseline draft");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("sends final baseline with keepalive on unmount despite a conflicting in-flight draft", async () => {
    const firstSave = deferredResponse();
    const baselineSave = deferredResponse();
    const initialEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("Baseline draft"),
      preview: "Baseline draft",
      word_count: 2,
    };
    let patchCount = 0;
    const fetchHandler = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? firstSave.promise : baselineSave.promise;
        }

        return jsonResponse(initialEssay);
      },
    );
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(workspaceKeys.essays.list(), {
      staleTime: Infinity,
    });
    queryClient.setQueryDefaults(
      workspaceKeys.essays.detail("stanford-roommate"),
      {
        staleTime: Infinity,
      },
    );
    queryClient.setQueryData(workspaceKeys.essays.list(), [initialEssay]);
    queryClient.setQueryData(
      workspaceKeys.essays.detail("stanford-roommate"),
      initialEssay,
    );
    vi.stubGlobal("fetch", fetchHandler);

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <BaselineAutosaveRaceHarness />
      </QueryClientProvider>,
    );

    await screen.findByTestId("cached-essay-content");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue draft B" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Revert baseline" }));
      unmount();
      await Promise.resolve();
    });

    const patchCalls = fetchHandler.mock.calls.filter(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[1]?.[1]?.keepalive).toBe(true);
    expect(JSON.parse(String(patchCalls[1]?.[1]?.body))).toEqual({
      content: tiptapDoc("Baseline draft"),
    });

    await act(async () => {
      firstSave.resolve(
        jsonResponse({
          ...initialEssay,
          content: tiptapDoc("Second draft"),
          preview: "Second draft",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      baselineSave.resolve(jsonResponse(initialEssay));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        tiptapText(
          queryClient.getQueryData<ApiEssay>(
            workspaceKeys.essays.detail("stanford-roommate"),
          )?.content,
        ),
      ).toBe("Baseline draft"),
    );
  });

  it("re-arms autosave mounted state across StrictMode effect replay", async () => {
    const save = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => save.promise),
    );

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <StrictMode>
          <AutosaveHarness />
        </StrictMode>
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    await act(async () => {
      save.resolve(jsonResponse(stanfordEssayDetail));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
  });

  it("does not autosave pristine content on editor blur", async () => {
    const { fetchHandler } = renderEditor();

    const editor = await screen.findByLabelText("Essay body");
    fireEvent.focus(editor);
    fireEvent.blur(editor);

    await waitFor(() => {
      expect(fetchHandler).not.toHaveBeenCalledWith(
        "/v1/essays/stanford-roommate",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("marks editor clean without PATCH when content returns to the initially loaded draft", async () => {
    const initialEssay: ApiEssay = {
      ...stanfordEssayDetail,
      content: tiptapDoc("A roommate line."),
      word_count: 3,
    };
    const fetchHandler = vi.fn(() => jsonResponse(initialEssay));
    vi.stubGlobal("fetch", fetchHandler);

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <EditorDirtySyncHarness essay={initialEssay} />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("Essay body")).toHaveTextContent(
      "A roommate line.",
    );
    vi.useFakeTimers();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Edit through Tiptap" }),
      );
      await Promise.resolve();
    });

    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saving");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("true");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Revert through Tiptap" }),
      );
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved");
    expect(screen.getByTestId("autosave-dirty")).toHaveTextContent("false");
    expect(fetchHandler).not.toHaveBeenCalledWith(
      "/v1/essays/stanford-roommate",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("syncs refetched editor content while pristine", async () => {
    const queryClient = createTestQueryClient();
    const onBack = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(stanfordEssayDetail)),
    );

    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EssayEditorPage
            essay={essayFromApi(stanfordEssayDetail)}
            onBack={onBack}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("A roommate line.")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EssayEditorPage
            essay={essayFromApi({
              ...stanfordEssayDetail,
              content: tiptapDoc("Server rewrite"),
              word_count: 2,
            })}
            onBack={onBack}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Server rewrite")).toBeInTheDocument();
  });

  it("keeps local dirty editor content when same essay refetches", async () => {
    const queryClient = createTestQueryClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(stanfordEssayDetail)),
    );

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <EditorDirtySyncHarness essay={stanfordEssayDetail} />
      </QueryClientProvider>,
    );

    const editor = await screen.findByLabelText("Essay body");
    expect(editor).toHaveTextContent("A roommate line.");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit through Tiptap" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Essay body")).toHaveTextContent(
        "Local dirty draft",
      ),
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <EditorDirtySyncHarness
          essay={{
            ...stanfordEssayDetail,
            content: tiptapDoc("Server rewrite"),
            word_count: 2,
          }}
        />
      </QueryClientProvider>,
    );

    const rerenderedEditor = screen.getByLabelText("Essay body");
    expect(rerenderedEditor).toHaveTextContent("Local dirty draft");
    expect(rerenderedEditor).not.toHaveTextContent("Server rewrite");
    expect(
      screen.queryByText("Server rewrite", { selector: ".ProseMirror *" }),
    ).not.toBeInTheDocument();
  });

  it("allows retry after the current direct autosave draft fails", async () => {
    const failedSave = deferredResponse();
    const retrySave = deferredResponse();
    let patchCount = 0;
    const fetchHandler = renderAutosaveHarness(
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          String(input).includes("/v1/essays/stanford-roommate") &&
          init?.method === "PATCH"
        ) {
          patchCount += 1;
          return patchCount === 1 ? failedSave.promise : retrySave.promise;
        }

        return jsonResponse(stanfordEssayDetail);
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue save" }));
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    await act(async () => {
      failedSave.resolve(jsonResponse({ detail: "failed" }, { status: 500 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("autosave-state")).toHaveTextContent("error");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Flush save" }));
      await Promise.resolve();
    });

    expect(fetchHandler.mock.calls).toHaveLength(2);

    await act(async () => {
      retrySave.resolve(
        jsonResponse({
          ...stanfordEssayDetail,
          content: tiptapDoc("Autosaved text"),
          word_count: 2,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId("autosave-state")).toHaveTextContent("saved"),
    );
  });
});

describe("essay routes", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";
  });

  it("renders the essay workspace route from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks", {
      fetchHandler: createWorkspaceFetchPreset({
        essayDetails: [commonEssayDetail, stanfordEssayDetail],
        essays: [commonEssay, stanfordEssay],
      }),
    });

    await user.click(await screen.findByRole("link", { name: "Essays" }));

    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/essays");
  });

  it("opens an essay editor route and restores saved server content", async () => {
    const user = userEvent.setup();
    renderApp("/app/essays", {
      fetchHandler: createWorkspaceFetchPreset({
        essayDetails: [commonEssayDetail, stanfordEssayDetail],
        essays: [commonEssay, stanfordEssay],
      }),
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Open Common App Personal Statement",
      }),
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/app/essays/common-app-main"),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Common App Personal Statement",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("A specific scene.").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Back to essays" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/essays"));
    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
  });

  it("shows an error and retry state for unknown essay IDs", async () => {
    const preset = createWorkspaceFetchPreset({
      essayDetails: [commonEssayDetail, stanfordEssayDetail],
      essays: [commonEssay, stanfordEssay],
    });

    renderApp("/app/essays/not-real", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.includes("/v1/essays/not-real")) {
          return jsonResponse({ detail: "Not found" }, { status: 404 });
        }
        return preset(input, init);
      },
    });

    expect(await screen.findByText("Could not load essay")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });
});
