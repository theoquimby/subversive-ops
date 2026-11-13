/** Loading skeleton — P&L: period switch, two rows of stats, food and beverage table. */

import { TextLine, SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, StatRowSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-20" description={3} />
      <ChipsSkeleton count={5} className="mb-3" />
      <TextLine className="w-80 max-w-full" line="mb-4 h-5" />
      <StatRowSkeleton className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <StatRowSkeleton />
      <SectionSkeleton action><TableSkeleton rows={4} cols={["2fr", "1fr", "0.8fr", "1fr", "0.8fr", "0.8fr", "1fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
