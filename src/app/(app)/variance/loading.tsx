/** Loading skeleton — Margin gap: count pickers, stats and the by-ingredient table. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" />
      <ChipsSkeleton count={3} className="mb-6" />
      <StatRowSkeleton className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <ChipsSkeleton count={2} className="mb-8" />
      <SectionSkeleton><TableSkeleton rows={6} cols={["3fr", "0.8fr", "0.8fr", "0.8fr", "0.8fr", "0.6fr"]} row="h-[4.4rem]" /></SectionSkeleton>
    </SkeletonPage>
  );
}
