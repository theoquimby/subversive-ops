/** Loading skeleton — Menu costs: the recipe cost table. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" description={2} actions={3} />
      <ChipsSkeleton count={4} />
      <SectionSkeleton><TableSkeleton rows={10} cols={["2fr", "0.8fr", "0.8fr", "0.8fr", "0.8fr", "0.8fr"]} row="h-[3.1rem]" /></SectionSkeleton>
    </SkeletonPage>
  );
}
