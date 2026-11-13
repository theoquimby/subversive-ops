/** Loading skeleton — Settings: link cards, then stacked sections. */

import { PageHeaderSkeleton, SectionSkeleton, SkeletonPage, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-28" />
      <SectionSkeleton><TableSkeleton rows={3} cols={["1fr"]} row="h-[4.5rem]" /></SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={4} cols={["2fr", "1fr", "1fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
