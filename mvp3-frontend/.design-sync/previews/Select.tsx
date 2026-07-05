import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "mvp3-frontend"

const rounds = [
  { value: "ed", label: "Early Decision" },
  { value: "ea", label: "Early Action" },
  { value: "rea", label: "Restrictive Early Action" },
  { value: "rd", label: "Regular Decision" },
]

export function Default() {
  return (
    <div className="w-64 py-2">
      <Select items={rounds} defaultValue="rea">
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {rounds.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  )
}
