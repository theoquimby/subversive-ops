/** Loading skeleton — Ordering: the Today strip, tabs, then the suppliers table. */

import { SkeletonPage, PageHeaderSkeleton, CardGridSkeleton, ChipsSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" />
      <CardGridSkeleton count={4} className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" height="h-[7.5rem]" />
      <ChipsSkeleton count={2} />
      <TableSkeleton rows={8} cols={["1.6fr", "2fr", "1fr", "1.4fr", "1fr", "1fr", "0.6fr"]} row="h-[3.4rem]" phoneCols={2} />
    </SkeletonPage>
  );
}
