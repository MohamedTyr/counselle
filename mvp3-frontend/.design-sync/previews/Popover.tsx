import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
  PopoverDescription,
  Button,
} from "mvp3-frontend"

export function Open() {
  return (
    <div className="flex justify-center py-16">
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" size="sm">Deadline info</Button>} />
        <PopoverPopup className="w-64">
          <PopoverTitle>Stanford REA</PopoverTitle>
          <PopoverDescription>
            Restrictive Early Action closes November 1 at 11:59pm PT.
          </PopoverDescription>
        </PopoverPopup>
      </Popover>
    </div>
  )
}
