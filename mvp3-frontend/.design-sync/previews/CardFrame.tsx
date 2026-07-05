import {
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardFrameDescription,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "mvp3-frontend"

// CardFrame groups multiple Cards into one seamless surface (used for stacked panels).
export function Grouped() {
  return (
    <CardFrame className="w-80">
      <CardFrameHeader>
        <CardFrameTitle>Application overview</CardFrameTitle>
        <CardFrameDescription>Fall 2027 · 12 schools</CardFrameDescription>
      </CardFrameHeader>
      <Card>
        <CardHeader>
          <CardTitle>Essays</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          8 of 24 drafts complete
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Deadlines</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Next: Stanford REA · Nov 1
        </CardContent>
      </Card>
    </CardFrame>
  )
}
