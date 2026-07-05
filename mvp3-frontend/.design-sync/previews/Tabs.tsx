import { Tabs, TabsList, TabsTab, TabsPanel } from "mvp3-frontend"

export function Default() {
  return (
    <Tabs defaultValue="today" className="w-96">
      <TabsList>
        <TabsTab value="today">Today</TabsTab>
        <TabsTab value="upcoming">Upcoming</TabsTab>
        <TabsTab value="all">All tasks</TabsTab>
      </TabsList>
      <TabsPanel value="today" className="p-4 text-sm text-muted-foreground">
        4 tasks due today across Essays and Aid.
      </TabsPanel>
      <TabsPanel value="upcoming" className="p-4 text-sm text-muted-foreground">
        Upcoming deadlines this week.
      </TabsPanel>
      <TabsPanel value="all" className="p-4 text-sm text-muted-foreground">
        Every task, grouped by school.
      </TabsPanel>
    </Tabs>
  )
}
