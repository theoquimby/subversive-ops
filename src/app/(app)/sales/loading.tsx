/** Loading skeleton: Sales & forecast. The verdict on the coming week, then the five-week calendar. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-44" actions={1} />
      <div className="mb-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <Bone className="h-6 w-2/3" />
        <Bone className="mt-3 h-3.5 w-1/2" />
        <Bone className="mt-6 h-40 w-full" />
      </div>
      <SectionSkeleton action>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
          {Array.from({ length: 35 }, (_, i) => <div key={i} className="h-24 bg-surface p-2"><Bone className="h-2.5 w-6" /><Bone className="mt-3 h-3.5 w-12" /></div>)}
        </div>
      </SectionSkeleton>
    </SkeletonPage>
  );
}
