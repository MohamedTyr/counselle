type RouteSurfaceProps = {
  title: string
}

export function RouteSurface({ title }: RouteSurfaceProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center border-b px-5">
        <h1 className="text-base font-semibold">{title}</h1>
      </header>
      <div className="min-h-0 flex-1" />
    </section>
  )
}
