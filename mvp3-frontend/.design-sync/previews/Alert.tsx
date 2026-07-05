import { Alert, AlertTitle, AlertDescription } from "mvp3-frontend"
import { Info, TriangleAlert } from "lucide-react"

export function Default() {
  return (
    <Alert className="w-96">
      <Info />
      <AlertTitle>Application deadline approaching</AlertTitle>
      <AlertDescription>
        Your Early Action schools are due November 1. 2 essays still need review.
      </AlertDescription>
    </Alert>
  )
}

export function Destructive() {
  return (
    <Alert variant="destructive" className="w-96">
      <TriangleAlert />
      <AlertTitle>Missing transcript</AlertTitle>
      <AlertDescription>
        Upload your official transcript before submitting this application.
      </AlertDescription>
    </Alert>
  )
}
