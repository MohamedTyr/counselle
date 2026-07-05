import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Button,
} from "mvp3-frontend"
import { FolderOpen } from "lucide-react"

export function Default() {
  return (
    <Empty className="w-96 rounded-xl border border-dashed bg-muted/20 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>No activities yet</EmptyTitle>
        <EmptyDescription>
          Add extracurriculars, honors, and work experience to build your profile.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">Add activity</Button>
      </EmptyContent>
    </Empty>
  )
}
