/** Loading skeleton — Timecards: week switcher, approval card, stats, issue list. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, StatRowSkeleton, SectionSkeleton, ListSkeleton, BlockSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" description={2} />
      <ChipsSkeleton count={4} className="mb-6" />
      <BlockSkeleton className="mb-6 h-16" />
      <StatRowSkeleton />
      <SectionSkeleton><ListSkeleton rows={5} /></SectionSkeleton>
    </SkeletonPage>
  );
}
