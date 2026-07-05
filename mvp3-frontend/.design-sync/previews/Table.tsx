import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from "mvp3-frontend"

// Mirrors the Schools table: School · Status · List Type · Round · Next Deadline · Progress
const schools = [
  {
    name: "Stanford University",
    status: "Applying",
    statusV: "info",
    type: "Reach",
    typeV: "warning",
    round: "REA",
    deadline: "Nov 1",
    done: 2,
    total: 5,
  },
  {
    name: "UC Berkeley",
    status: "Considering",
    statusV: "secondary",
    type: "Target",
    typeV: "info",
    round: "RD",
    deadline: "Nov 30",
    done: 0,
    total: 4,
  },
  {
    name: "Boston University",
    status: "Submitted",
    statusV: "success",
    type: "Safety",
    typeV: "success",
    round: "ED",
    deadline: "Jan 4",
    done: 3,
    total: 3,
  },
  {
    name: "University of Michigan",
    status: "Waitlisted",
    statusV: "warning",
    type: "Target",
    typeV: "info",
    round: "EA",
    deadline: "—",
    done: 4,
    total: 4,
  },
] as const

export function SchoolsList() {
  return (
    <div className="w-[46rem]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>School</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>List Type</TableHead>
            <TableHead>Round</TableHead>
            <TableHead>Next Deadline</TableHead>
            <TableHead>Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schools.map((s) => (
            <TableRow key={s.name}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>
                <Badge variant={s.statusV}>{s.status}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={s.typeV}>{s.type}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{s.round}</TableCell>
              <TableCell className="text-muted-foreground">
                {s.deadline}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {s.done}/{s.total} essays
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function CardVariant() {
  return (
    <div className="w-[40rem]">
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>School</TableHead>
            <TableHead>Round</TableHead>
            <TableHead>Next Deadline</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schools.map((s) => (
            <TableRow key={s.name}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="text-muted-foreground">{s.round}</TableCell>
              <TableCell className="text-muted-foreground">
                {s.deadline}
              </TableCell>
              <TableCell>
                <Badge variant={s.statusV}>{s.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
