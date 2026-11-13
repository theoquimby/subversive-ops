/** Loading skeleton — Training: four stat tiles, the matrix, types grid and checklists. */

import { BlockSkeleton, ChipsSkeleton, PageHeaderSkeleton, SectionSkeleton, SkeletonPage, StatRowSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-64" actions={1} />
      <StatRowSkeleton count={4} />
      <SectionSkeleton>
        <ChipsSkeleton count={2} className="mb-3" />
        <TableSkeleton rows={8} cols={["1.6fr", "1fr", "1fr", "1fr", "1fr", "1fr", "1fr", "1fr"]} />
      </SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={6} cols={["2fr", "0.8fr", "2.4fr", "0.7fr", "0.7fr", "0.8fr", "0.6fr"]} /></SectionSkeleton>
      <SectionSkeleton><BlockSkeleton className="h-64" /></SectionSkeleton>
    </SkeletonPage>
  );
}
