/** Loading skeleton — Team: positions table and people table. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-24" actions={1} />
      <SectionSkeleton><TableSkeleton rows={5} cols={["1.6fr", "1fr", "0.8fr", "0.6fr", "0.6fr", "0.8fr", "0.4fr", "0.4fr"]} /></SectionSkeleton>
      <SectionSkeleton><TableSkeleton rows={6} cols={["1.4fr", "2fr", "0.8fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.8fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
