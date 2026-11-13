/** Loading skeleton — Prices: supplier filter chips and the price table. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-24" actions={2} />
      <ChipsSkeleton count={6} />
      <TableSkeleton rows={10} cols={["2.4fr", "0.7fr", "1.4fr", "1.2fr", "0.8fr"]} row="h-[3.1rem]" />
    </SkeletonPage>
  );
}
