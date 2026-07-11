import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type KeyboardEvent } from "react";

import type { SkillCatalogEntry } from "@/api/chat/types";
import { SelectedSkillChips } from "@/features/skill-picker/SelectedSkillChips";
import { SkillPicker } from "@/features/skill-picker/SkillPicker";
import { useSkillPicker } from "@/features/skill-picker/useSkillPicker";

const catalog: SkillCatalogEntry[] = [
  {
    name: "school-comparison",
    displayName: "School comparison",
    description: "Compare admissions, aid, and outcomes.",
  },
  {
    name: "dossier-assembly",
    displayName: "School dossier",
    description: "Build a detailed brief for one school.",
  },
];

function Harness({
  disabled = false,
  initialText = "",
  maxSelectedSkills = 3,
}: {
  disabled?: boolean;
  initialText?: string;
  maxSelectedSkills?: number;
}) {
  const [text, setText] = useState(initialText);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [sends, setSends] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const picker = useSkillPicker({
    catalog,
    maxSelectedSkills,
    onSelectedSkillsChange: setSelectedSkills,
    onTextChange: setText,
    selectedSkills,
    text,
    textareaRef,
    disabled,
  });

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (picker.handleKeyDown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setSends((count) => count + 1);
    }
  }

  return (
    <form>
      <textarea
        aria-activedescendant={picker.activeOptionId}
        aria-autocomplete="list"
        aria-controls={picker.isOpen ? picker.listboxId : undefined}
        aria-expanded={picker.isOpen}
        aria-label="Message Counselle"
        onChange={picker.handleTextChange}
        onCompositionEnd={picker.handleCompositionEnd}
        onCompositionStart={picker.handleCompositionStart}
        onKeyDown={handleKeyDown}
        onSelect={picker.handleTextareaSelect}
        ref={textareaRef}
        role="combobox"
        value={text}
      />
      <button
        aria-label="Add a skill (@)"
        onClick={picker.insertTrigger}
        type="button"
      >
        Add a skill
      </button>
      <output aria-label="Sent count">{sends}</output>
      <SelectedSkillChips
        catalog={catalog}
        onRemove={picker.removeSelectedSkill}
        selectedSkills={selectedSkills}
      />
      <SkillPicker
        activeIndex={picker.activeIndex}
        anchorRef={textareaRef}
        announcement={picker.announcement}
        isOpen={picker.isOpen}
        listboxId={picker.listboxId}
        onClose={picker.close}
        onSelect={picker.selectSkill}
        query={picker.query}
        results={picker.results}
        selectedSkills={selectedSkills}
        setActiveIndex={picker.setActiveIndex}
      />
    </form>
  );
}

function DisableAfterOpenHarness() {
  const [disabled, setDisabled] = useState(false);

  return (
    <>
      <button onClick={() => setDisabled(true)} type="button">
        Disable picker
      </button>
      <Harness disabled={disabled} />
    </>
  );
}

describe("SkillPicker", () => {
  it("keeps focus in the textarea while typing, filtering, and choosing with Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "@sch");

    expect(textarea).toHaveFocus();
    expect(textarea).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Skills" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /school comparison/i }),
    ).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");

    expect(screen.getByText("School comparison")).toBeInTheDocument();
    expect(textarea).toHaveValue("");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it("preserves the unresolved token for Escape, Shift+Enter, and IME composition", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@school");
    await user.keyboard("{Escape}");
    expect(textarea).toHaveValue("@school");
    expect(textarea).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");
  });

  it("restores textarea focus after pointer selection and prevents duplicates", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@school");
    fireEvent.pointerDown(
      screen.getByRole("option", { name: /school comparison/i }),
    );
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(screen.getByText("School comparison")).toBeInTheDocument();

    await user.type(textarea, "@school");
    expect(
      screen.getByRole("option", { name: /school comparison/i }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.pointerDown(
      screen.getByRole("option", { name: /school comparison/i }),
    );
    expect(screen.getAllByText("School comparison")).toHaveLength(2);
  });

  it("inserts a trigger at a middle selection without losing surrounding text", async () => {
    const user = userEvent.setup();
    render(<Harness initialText="Compare Harvard and Yale" />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(8, 15);
    fireEvent.select(textarea);
    await user.click(screen.getByRole("button", { name: "Add a skill (@)" }));

    expect(textarea).toHaveValue("Compare @ and Yale");
    expect(textarea.selectionStart).toBe(9);
    expect(textarea.selectionEnd).toBe(9);
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps a toolbar-created trigger open after a word boundary", async () => {
    const user = userEvent.setup();
    render(<Harness initialText="Compare Duke" />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(12, 12);
    await user.click(screen.getByRole("button", { name: "Add a skill (@)" }));
    await user.type(textarea, "s");

    expect(textarea).toHaveValue("Compare Duke @s");
    expect(textarea).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps an unmatched @query as text instead of sending it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@nothing");
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");
    expect(textarea).toHaveValue("@nothing");
  });

  it("resets the active option when filtering changes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@");
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("option", { name: /school dossier/i }),
    ).toHaveAttribute("aria-selected", "true");

    await user.type(textarea, "s");
    expect(
      screen.getByRole("option", { name: /school comparison/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("removes the active-descendant reference when disabled", async () => {
    const user = userEvent.setup();
    render(<DisableAfterOpenHarness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@school");
    expect(textarea).toHaveAttribute("aria-activedescendant");

    await user.click(screen.getByRole("button", { name: "Disable picker" }));
    expect(textarea).not.toHaveAttribute("aria-activedescendant");
  });

  it("announces the selection cap and lets a chip be removed", async () => {
    const user = userEvent.setup();
    render(<Harness maxSelectedSkills={1} />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@school");
    await user.keyboard("{Enter}");
    await user.type(textarea, "@dossier");
    await user.keyboard("{Enter}");

    expect(
      screen.getByText("You can select up to 1 skills."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Remove School comparison" }),
    );
    expect(
      screen.queryByRole("button", { name: "Remove School comparison" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("School comparison removed.")).toBeInTheDocument();
  });

  it("uses an instant reduced-motion popup contract", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "@");

    expect(screen.getByRole("dialog").className).toContain(
      "motion-reduce:transition-none",
    );
  });
});
