import type { Editor } from "@tiptap/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Undo2,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  fontOptions,
  type ToolbarState,
} from "@/features/essays/essay-toolbar-config";
import { cn } from "@/lib/utils";

type ToolButtonProps = {
  active?: boolean;
  disabled?: boolean;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  onClick: () => void;
  toggle?: boolean;
};

function ToolButton({
  active = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
  toggle = false,
}: ToolButtonProps) {
  return (
    <ToolbarButton
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      disabled={disabled}
      onClick={onClick}
      render={
        <Button
          className={cn(active && "bg-(--essay-editor-toolbar-active)")}
          size="icon-sm"
          title={label}
          type="button"
          variant="ghost"
        />
      }
    >
      <Icon />
    </ToolbarButton>
  );
}

export function EssayEditorToolbar({
  editor,
  state,
}: {
  editor: Editor | null;
  state: ToolbarState;
}) {
  const disabled = !editor;

  function handleFontChange(value: string | null) {
    if (!editor || !value) {
      return;
    }

    if (value === "default") {
      editor.chain().focus().unsetFontFamily().run();
      return;
    }

    editor.chain().focus().setFontFamily(value).run();
  }

  return (
    <Toolbar
      aria-label="Essay formatting toolbar"
      className="inline-flex w-max flex-nowrap items-center justify-start border-transparent bg-(--essay-editor-toolbar-surface) shadow-(--essay-editor-toolbar-shadow)"
    >
      <ToolbarGroup>
        <Select
          disabled={disabled}
          items={fontOptions}
          onValueChange={handleFontChange}
          value={state.fontFamily}
        >
          <SelectTrigger
            aria-label="Font"
            className="h-7 min-h-7 w-[116px] min-w-[116px] rounded-md border-border px-2 text-xs font-medium shadow-none sm:min-h-7"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="start" side="top" sideOffset={8}>
            {fontOptions.map((font) => (
              <SelectItem key={font.value} value={font.value}>
                <span
                  className="truncate"
                  style={{
                    fontFamily:
                      font.value === "default" ? undefined : font.value,
                  }}
                >
                  {font.label}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </ToolbarGroup>
      <ToolbarSeparator orientation="vertical" />
      <ToolbarGroup>
        <ToolButton
          active={state.isBold}
          disabled={disabled}
          icon={Bold}
          label="Bold"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          toggle
        />
        <ToolButton
          active={state.isItalic}
          disabled={disabled}
          icon={Italic}
          label="Italic"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          toggle
        />
        <ToolButton
          active={state.isHeading}
          disabled={disabled}
          icon={Heading2}
          label="Heading"
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
          toggle
        />
      </ToolbarGroup>
      <ToolbarSeparator orientation="vertical" />
      <ToolbarGroup>
        <ToolButton
          active={state.isBulletList}
          disabled={disabled}
          icon={List}
          label="Bulleted list"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          toggle
        />
        <ToolButton
          active={state.isOrderedList}
          disabled={disabled}
          icon={ListOrdered}
          label="Numbered list"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          toggle
        />
        <ToolButton
          active={state.isBlockquote}
          disabled={disabled}
          icon={Quote}
          label="Quote"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          toggle
        />
      </ToolbarGroup>
      <ToolbarSeparator orientation="vertical" />
      <ToolbarGroup>
        <ToolButton
          disabled={disabled}
          icon={AlignLeft}
          label="Align left"
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        />
        <ToolButton
          active={state.isAlignCenter}
          disabled={disabled}
          icon={AlignCenter}
          label="Align center"
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          toggle
        />
        <ToolButton
          active={state.isAlignRight}
          disabled={disabled}
          icon={AlignRight}
          label="Align right"
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          toggle
        />
      </ToolbarGroup>
      <ToolbarSeparator orientation="vertical" />
      <ToolbarGroup>
        <ToolButton
          disabled={disabled}
          icon={RemoveFormatting}
          label="Clear formatting"
          onClick={() =>
            editor?.chain().focus().unsetAllMarks().clearNodes().run()
          }
        />
        <ToolButton
          disabled={disabled}
          icon={Undo2}
          label="Undo"
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <ToolButton
          disabled={disabled}
          icon={Redo2}
          label="Redo"
          onClick={() => editor?.chain().focus().redo().run()}
        />
      </ToolbarGroup>
    </Toolbar>
  );
}
