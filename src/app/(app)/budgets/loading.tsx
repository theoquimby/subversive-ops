/** Loading skeleton — Budgets: four stats, then the weekly targets grid. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" actions={2} />
      <StatRowSkeleton />
      <SectionSkeleton><TableSkeleton rows={8} cols={["1.4fr", "1fr", "1fr", "1fr", "0.8fr"]} row="h-[3.6rem]" phoneCols={3} /></SectionSkeleton>
    </SkeletonPage>
  );
}
