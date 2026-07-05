import { EssayLibraryCard } from "mvp3-frontend"
import { essays } from "@/fixtures/essays"

export function Drafting() {
  return (
    <div className="w-80">
      <EssayLibraryCard essay={essays[0]} onOpenEssay={() => {}} />
    </div>
  )
}

export function NeedsReview() {
  return (
    <div className="w-80">
      <EssayLibraryCard essay={essays[1]} onOpenEssay={() => {}} />
    </div>
  )
}
