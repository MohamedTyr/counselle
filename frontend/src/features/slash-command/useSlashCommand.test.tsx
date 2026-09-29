import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type KeyboardEvent } from "react";

import type { SkillCatalogEntry } from "@/api/chat/types";
import { SkillPicker } from "@/features/skill-picker/SkillPicker";
import { useSkillPicker } from "@/features/skill-picker/useSkillPicker";
import { SlashCommandMenu } from "@/features/slash-command/SlashCommandMenu";
import { useSlashCommand } from "@/features/slash-command/useSlashCommand";

const skillCatalog: SkillCatalogEntry[] = [
  {
    name: "school-comparison",
    displayName: "School comparison",
    description: "Compare admissions, aid, and outcomes.",
  },
];

/**
 * Composes the slash-command hook with the real `useSkillPicker`, in the
 * order the plan specifies for the eventual composer wiring: slash first,
 * then skill, then submit (§5.5 / `AiComposer.tsx:117-119`). This harness is
 * how the module boundary is exercised without touching either composer
 * file, which this phase does not own.
 */
function Harness({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [sends, setSends] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slash = useSlashCommand({
    onTextChange: setText,
    text,
    textareaRef,
  });
  const skill = useSkillPicker({
    catalog: skillCatalog,
    maxSelectedSkills: 3,
    onSelectedSkillsChange: setSelectedSkills,
    onTextChange: setText,
    selectedSkills,
    text,
    textareaRef,
  });

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (slash.handleKeyDown(event)) {
      return;
    }
    if (skill.handleKeyDown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setSends((count) => count + 1);
      slash.clearArmedCommand();
      setText("");
    }
  }

  return (
    <form>
      <textarea
        aria-activedescendant={slash.activeOptionId ?? skill.activeOptionId}
        aria-label="Message Counselle"
        onChange={(event) => {
          slash.handleTextChange(event);
          skill.handleTextChange(event);
        }}
        onKeyDown={handleKeyDown}
        onSelect={(event) => {
          slash.handleTextareaSelect(event);
          skill.handleTextareaSelect(event);
        }}
        ref={textareaRef}
        role="combobox"
        value={text}
      />
      <output aria-label="Sent count">{sends}</output>
      <output aria-label="Armed command">{slash.armedCommandId ?? ""}</output>
      <SlashCommandMenu
        activeIndex={slash.activeIndex}
        anchorRef={textareaRef}
        announcement={slash.announcement}
        isOpen={slash.isOpen}
        listboxId={slash.listboxId}
        onClose={slash.close}
        onSelect={slash.selectCommand}
        query={slash.query}
        results={slash.results}
        setActiveIndex={slash.setActiveIndex}
      />
      <SkillPicker
        activeIndex={skill.activeIndex}
        anchorRef={textareaRef}
        announcement={skill.announcement}
        isOpen={skill.isOpen}
        listboxId={skill.listboxId}
        onClose={skill.close}
        onSelect={skill.selectSkill}
        query={skill.query}
        results={skill.results}
        selectedSkills={selectedSkills}
        setActiveIndex={skill.setActiveIndex}
      />
    </form>
  );
}

describe("useSlashCommand trigger detection", () => {
  it("opens the menu only when the slash is the first character", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/go");

    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /goal mode/i }),
    ).toBeInTheDocument();
  });

  it("does not open on a slash inside ordinary text such as 'and/or'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    await user.click(textarea);
    await user.type(textarea, "cost and/or aid");

    expect(
      screen.queryByRole("listbox", { name: "Commands" }),
    ).not.toBeInTheDocument();
  });

  it("does not open when the slash arrives mid-sentence even at the start of typing", async () => {
    render(<Harness initialText="tell me " />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    // Place the caret at the end and type a slash — it is not at position 0.
    fireEvent.change(textarea, { target: { value: "tell me /goal" } });
    fireEvent.select(textarea, {
      target: { selectionStart: 13, selectionEnd: 13 },
    });

    expect(
      screen.queryByRole("listbox", { name: "Commands" }),
    ).not.toBeInTheDocument();
  });

  it("does not open when the slash starts a second line of a multi-line composer", async () => {
    render(<Harness initialText={"first line\n"} />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    });

    // The trigger fires at position 0 of the whole composer only, not at
    // position 0 of a line — a "/" opening a fresh second line must not
    // open the menu.
    fireEvent.change(textarea, { target: { value: "first line\n/" } });
    fireEvent.select(textarea, {
      target: { selectionStart: 12, selectionEnd: 12 },
    });

    expect(
      screen.queryByRole("listbox", { name: "Commands" }),
    ).not.toBeInTheDocument();
  });
});

describe("useSlashCommand selection and arming", () => {
  it("removes the token and arms the command only on explicit Enter selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("");

    await user.keyboard("{Enter}");

    expect(textarea).toHaveValue("");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it("removes the token and arms on pointer selection too", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    fireEvent.pointerDown(screen.getByRole("option", { name: /goal mode/i }));

    expect(textarea).toHaveValue("");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");
  });

  it("does NOT arm goal mode from typed text alone — only an explicit selection arms it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    // The student types past the popover and sends the literal text as an
    // ordinary message, per §5.5's "conservative reading". Verified here at
    // the hook's own boundary: armedCommandId stays null and the composer
    // text is left untouched (no token removal happens without selection).
    fireEvent.keyDown(textarea, { key: " " });
    fireEvent.change(textarea, { target: { value: "/goal please" } });

    expect(screen.getByLabelText("Armed command")).toHaveTextContent("");
    expect(textarea).toHaveValue("/goal please");

    // The user-visible guarantee, not just the internal flag: sending this
    // text goes through as an ordinary message.
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("");
  });
});

describe("useSlashCommand chip lifecycle", () => {
  it("clears the armed command when the composer is emptied", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");

    // Selecting the command already leaves the composer empty while armed
    // (the student is expected to type the goal request next) — that must
    // not itself clear the chip. Only emptying it *afterward* should.
    await user.type(textarea, "check my chances");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");

    fireEvent.change(textarea, { target: { value: "" } });

    await waitFor(() =>
      expect(
        screen.getByLabelText("Armed command"),
      ).not.toHaveTextContent("goal"),
    );
  });

  it("clears the armed command on send", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");

    await user.type(textarea, "check my chances");
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Sent count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("");
  });
});

describe("useSlashCommand keydown ordering", () => {
  it("does not steal keys from the skill picker or from submit when its own menu is closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "@sch");
    expect(screen.getByRole("listbox", { name: "Skills" })).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(textarea).toHaveValue("@school-comparison  ");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");

    await user.type(textarea, "thanks");
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("1");
  });

  it("resolves the slash menu before the skill picker when both could react to a key", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByRole("combobox", {
      name: "Message Counselle",
    }) as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "/goal");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(
      screen.queryByRole("listbox", { name: "Skills" }),
    ).not.toBeInTheDocument();

    // Enter is consumed by the slash menu (arms + closes), never reaching
    // the skill picker or the submit handler.
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Armed command")).toHaveTextContent("goal");
    expect(screen.getByLabelText("Sent count")).toHaveTextContent("0");
  });
});
