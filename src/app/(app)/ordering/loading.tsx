/** Loading skeleton — Ordering: supplier cards, then cutoffs. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" />
      <SectionSkeleton description={false}><CardGridSkeleton count={4} height="h-[8.5rem]" /></SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={4} cols={["2fr", "0.8fr", "1fr", "1fr", "1.5fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
