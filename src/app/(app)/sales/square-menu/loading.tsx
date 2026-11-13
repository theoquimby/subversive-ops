/** Loading skeleton — Menu from Square: stats and three matching sections. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, SectionSkeleton, BlockSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-48" description={2} />
      <StatRowSkeleton className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <BlockSkeleton className="mb-10 h-12" />
      {Array.from({ length: 3 }, (_, i) => <SectionSkeleton key={i}><BlockSkeleton className="h-16" /></SectionSkeleton>)}
    </SkeletonPage>
  );
}
