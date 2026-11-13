/** Loading skeleton — Sales & forecast: stats and the five-week calendar. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-44" actions={1} />
      <StatRowSkeleton />
      <SectionSkeleton action>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {Array.from({ length: 35 }, (_, i) => <div key={i} className="h-24 bg-surface p-2"><Bone className="h-2.5 w-6" /><Bone className="mt-3 h-3.5 w-12" /></div>)}
        </div>
      </SectionSkeleton>
    </SkeletonPage>
  );
}
