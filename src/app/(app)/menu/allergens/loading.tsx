/** Loading skeleton — Allergen chart: a wide grid of dots. */

import { SkeletonPage, PageHeaderSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-40" description={2} actions={1} />
      <TableSkeleton rows={12} cols={["3fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr", "0.6fr"]} row="h-[2.3rem]" />
    </SkeletonPage>
  );
}
