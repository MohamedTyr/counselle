# Counselle Design System — usage guide

Counselle is a college-application workspace (tasks, schools, essays, activities,
calendar). These are the real, shipped React components. Build with them directly.

## Theme & setup

- **Dark is the default theme.** The app renders with `.dark` on `<html>`; all colors below
  resolve to their dark values there. A light theme also exists (drop the `.dark` class).
- Import everything from the design-system global (`window.CounselleDS.*`) — every export in
  this guide is available, including compound sub-parts (`CardHeader`, `SelectItem`,
  `TableRow`, `SheetPopup`, every `Sidebar*` part) even when they have no standalone card.
- Components that read layout context must be wrapped: anything `Sidebar*` needs
  `<SidebarProvider>`; `Tooltip*` needs `<TooltipProvider>`. `Select`, `Sheet`, and `Popover`
  are base-ui and take `defaultOpen`/`open`; `DropdownMenu` is radix-style (`<DropdownMenuTrigger asChild>`).

## Styling idiom — Tailwind v4 semantic tokens

Style with Tailwind utility classes bound to **semantic color tokens** (never hard-coded hex).
Use the token utilities so both themes work automatically:

| Purpose | Utilities |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-sidebar` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground` |
| Accent / brand | `bg-primary text-primary-foreground`, `bg-secondary text-secondary-foreground` |
| Borders / focus | `border-border`, `border-input`, `ring-ring` |
| Status | `bg-destructive`, `text-destructive`, plus `success` / `warning` / `info` token families |
| Radius | `rounded-lg`, `rounded-xl`, `rounded-2xl` (driven by `--radius`) |

Font: **Geist Variable** (`font-sans`); documents use a serif (`font-document`).

## Component conventions (match the product)

- **Button** `variant`: default · secondary · outline · ghost · link · destructive ·
  destructive-outline. `size`: xs · sm · default · lg · xl · icon / icon-sm / icon-lg / icon-xl.
  `loading` shows an inline spinner.
- **Badge** carries status. Use these exact variant mappings (they match the app):
  - Task status → `todo`=secondary, `doing`=info, `waiting`=warning, `done`=success.
  - Application status → Considering=secondary, Applying=info, Submitted/Accepted=success,
    Waitlisted=warning, Rejected=error.
  - List type → Reach=warning, Target=info, Safety=success. Priority → high=error, med=warning, low=success.
- **Card**: `Card > CardHeader (CardTitle, CardDescription, CardAction) + CardContent + CardFooter`.
  `CardFrame` groups several `Card`s into one seamless stacked surface.
- **Table**: `Table[variant=default|card] > TableHeader/TableBody > TableRow > TableHead/TableCell`.
  The Schools table columns are School · Status · List Type · Round · Next Deadline · Progress · Essays.
- **EssayLibraryCard** is the essays-page card; pass a full `essay` object and `onOpenEssay`.
- **Sidebar** is the workspace nav (Tasks · Calendar · Essays · Schools · Activities).

## Where the truth lives

Read `styles.css` (and its `@import` closure: `_ds_bundle.css`, `fonts/`) for the full token
set, and each component's `components/<group>/<Name>/<Name>.prompt.md` + `.d.ts` for its API.

## Idiomatic example

```tsx
<Card className="w-80">
  <CardHeader>
    <CardTitle>Stanford University</CardTitle>
    <CardDescription>Restrictive Early Action</CardDescription>
    <CardAction><Badge variant="warning">Due Nov 1</Badge></CardAction>
  </CardHeader>
  <CardContent className="text-sm text-muted-foreground">
    3 supplemental essays remaining.
  </CardContent>
  <CardFooter className="gap-2">
    <Button size="sm">Open</Button>
    <Button size="sm" variant="outline">Notes</Button>
  </CardFooter>
</Card>
```
