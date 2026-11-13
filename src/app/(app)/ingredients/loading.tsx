/** Loading skeleton — Ingredients grid: search, then a long editable table. */

import { SkeletonPage, PageHeaderSkeleton, TableSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-36" description={2} actions={1} />
      <Bone className="mb-4 h-9 w-full rounded-lg sm:w-64" />
      <TableSkeleton rows={12} cols={["2fr", "0.4fr", "1fr", "1fr", "0.8fr", "0.6fr", "0.6fr", "0.8fr", "0.9fr", "0.8fr"]} row="h-[2.9rem]" />
    </SkeletonPage>
  );
}
