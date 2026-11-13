/** Loading skeleton — Reviews: stats, three fix-it cards, trend chart. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, CardGridSkeleton, BlockSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-28" actions={2} />
      <StatRowSkeleton />
      <SectionSkeleton action><CardGridSkeleton count={3} className="grid gap-3 lg:grid-cols-3" height="h-52" lines={4} /></SectionSkeleton>
      <SectionSkeleton><BlockSkeleton className="h-48" /></SectionSkeleton>
    </SkeletonPage>
  );
}
