/** Loading skeleton — Accounting exports: four stats and two export sections. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton, BlockSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-56" description={2} actions={2} />
      <StatRowSkeleton />
      <SectionSkeleton action><BlockSkeleton className="h-32" /></SectionSkeleton>
      <SectionSkeleton action><TableSkeleton rows={6} cols={["0.6fr", "3fr", "1fr", "0.6fr", "0.6fr", "1fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
