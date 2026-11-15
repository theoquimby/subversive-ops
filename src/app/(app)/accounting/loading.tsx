/** Loading skeleton — Month-end: period picker, four stats, checklist and inventory side by side. */

import { ChipsSkeleton, ListSkeleton, PageHeaderSkeleton, SectionSkeleton, SkeletonPage, StatRowSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" description={1} actions={1} />
      <ChipsSkeleton count={3} className="mb-6" />
      <StatRowSkeleton className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <div className="grid gap-x-6 lg:grid-cols-2">
        <SectionSkeleton><ListSkeleton rows={6} /></SectionSkeleton>
        <SectionSkeleton><ListSkeleton rows={5} /></SectionSkeleton>
      </div>
    </SkeletonPage>
  );
}
