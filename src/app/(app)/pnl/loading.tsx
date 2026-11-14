/** Loading skeleton — P&L: period switch, the headline and bridge, four stats, notes. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, StatRowSkeleton, SectionSkeleton, ListSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-20" description={1} />
      <ChipsSkeleton count={5} className="mb-6" />
      <div className="mb-3 grid rounded-xl border border-border bg-surface lg:grid-cols-[5fr_7fr]">
        <div className="p-5 sm:p-6">
          <Bone className="h-3.5 w-36" />
          <Bone className="mt-3 h-12 w-40" />
          <Bone className="mt-4 h-4 w-56 max-w-full" />
          <Bone className="mt-5 h-3 w-64 max-w-full" />
          <Bone className="mt-2 h-3 w-60 max-w-full" />
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          {Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-3.5 w-full" />)}
        </div>
      </div>
      <StatRowSkeleton className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <SectionSkeleton><ListSkeleton rows={4} /></SectionSkeleton>
    </SkeletonPage>
  );
}
