import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "mvp3-frontend"
import { Bold, Italic, Underline, List, Link2 } from "lucide-react"

export function EditorToolbar() {
  return (
    <Toolbar
      aria-label="Essay formatting"
      className="inline-flex w-max items-center gap-0.5 rounded-xl border bg-background/95 p-1"
    >
      <ToolbarGroup>
        <ToolbarButton aria-label="Bold"><Bold /></ToolbarButton>
        <ToolbarButton aria-label="Italic"><Italic /></ToolbarButton>
        <ToolbarButton aria-label="Underline"><Underline /></ToolbarButton>
      </ToolbarGroup>
      <ToolbarSeparator orientation="vertical" />
      <ToolbarGroup>
        <ToolbarButton aria-label="Bullet list"><List /></ToolbarButton>
        <ToolbarButton aria-label="Link"><Link2 /></ToolbarButton>
      </ToolbarGroup>
    </Toolbar>
  )
}
