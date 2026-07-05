export type EssayCardStatus =
  | "Not started"
  | "Drafting"
  | "Needs review"
  | "Ready"
  | "Submitted"

export type EssayCardType =
  | "Personal statement"
  | "Supplement"
  | "Scholarship"
  | "Optional"

export type EssayLibraryCardData = {
  id: string
  title: string
  school: string
  schoolLocation: string
  logoUrl: string
  type: EssayCardType
  status: EssayCardStatus
  wordCount: number
  wordLimit: number
  deadline: string
  updatedAt: string
  version: string
  comments: number
  suggestions: number
  dueSoon?: boolean
  risk?: "Over limit" | "Missing real detail" | "Reuse risk" | "Too generic"
  previewTitle: string
  previewLines: string[]
}
