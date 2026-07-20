import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { School } from "@/domain/school";
import {
  DeadlineValue,
  EssaysValue,
  ListTypeBadge,
  ProgressValue,
  SchoolIdentity,
  SchoolWebsiteLink,
  StatusBadge,
} from "@/features/schools/school-cells";

function MobileMetric({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SchoolMobileCard({
  onOpenSchool,
  school,
}: {
  onOpenSchool: (schoolId: string) => void;
  school: School;
}) {
  return (
    <article
      className="rounded-xl border bg-card p-4 shadow-xs"
      onClick={() => onOpenSchool(school.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <SchoolIdentity layout="mobile" onOpen={onOpenSchool} school={school} />
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={school.status} />
          <SchoolWebsiteLink school={school} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <MobileMetric label="List">
          <ListTypeBadge listType={school.listType} />
        </MobileMetric>
        <MobileMetric label="Round">
          <Badge variant="outline">{school.round}</Badge>
        </MobileMetric>
        <MobileMetric label="Deadline">
          <DeadlineValue school={school} />
        </MobileMetric>
        <MobileMetric label="Progress">
          <ProgressValue progress={school.progress} />
        </MobileMetric>
        <MobileMetric label="Essays">
          <EssaysValue essays={school.essays} />
        </MobileMetric>
      </div>
    </article>
  );
}

export function SchoolMobileList({
  onOpenSchool,
  schools,
}: {
  onOpenSchool: (schoolId: string) => void;
  schools: School[];
}) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {schools.length === 0 ? (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          No schools match these filters.
        </div>
      ) : (
        schools.map((school) => (
          <SchoolMobileCard
            key={school.id}
            onOpenSchool={onOpenSchool}
            school={school}
          />
        ))
      )}
    </div>
  );
}
