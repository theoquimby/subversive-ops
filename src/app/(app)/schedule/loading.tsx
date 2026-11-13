/** Loading skeleton — Schedule: week switcher, stats and the board. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, StatRowSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" />
      <ChipsSkeleton count={5} />
      <StatRowSkeleton className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <div className="grid grid-cols-[7rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-xl border border-border bg-border">
        {Array.from({ length: 40 }, (_, i) => <div key={i} className="h-20 bg-surface p-1.5">{i % 8 !== 0 && i % 3 !== 1 && <Bone className="h-8 w-full rounded-md" />}{i % 8 === 0 && <Bone className="mt-2 h-3 w-16" />}</div>)}
      </div>
    </SkeletonPage>
  );
}
