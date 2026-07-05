import { Logo } from "mvp3-frontend"

export function Default() {
  return (
    <div className="flex items-center gap-3 py-2 text-foreground">
      <Logo className="size-8" />
      <span className="text-lg font-semibold">Counselle</span>
    </div>
  )
}
