import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
  Badge,
} from "mvp3-frontend"

export function Basic() {
  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Common App Essay</CardTitle>
        <CardDescription>Personal statement · 650 words</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Draft your response to the prompt about a challenge you overcame. Aim
        for a specific, vivid opening scene.
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">Open editor</Button>
        <Button size="sm" variant="outline">
          Notes
        </Button>
      </CardFooter>
    </Card>
  )
}

export function WithAction() {
  return (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Stanford University</CardTitle>
        <CardDescription>Restrictive Early Action</CardDescription>
        <CardAction>
          <Badge variant="warning">Due Nov 1</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        3 supplemental essays remaining. Last edited 2 days ago.
      </CardContent>
    </Card>
  )
}
