import {
  Sheet,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetPanel,
  Button,
} from "mvp3-frontend"

export function Open() {
  return (
    <Sheet defaultOpen>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>Task details</SheetTitle>
          <SheetDescription>Berkeley CSS Profile correction</SheetDescription>
        </SheetHeader>
        <SheetPanel className="text-sm text-muted-foreground">
          Update the reported income figure and re-submit the CSS Profile before
          the priority aid deadline.
        </SheetPanel>
        <SheetFooter>
          <Button size="sm">Mark done</Button>
          <Button size="sm" variant="outline">Snooze</Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  )
}
