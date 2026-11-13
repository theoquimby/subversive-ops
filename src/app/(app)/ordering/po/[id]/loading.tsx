/** Loading skeleton — A purchase order: summary cards and its lines. */

import { SkeletonPage, PageHeaderSkeleton, CardGridSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-56" actions={2} />
      <CardGridSkeleton count={2} className="mb-6 grid gap-3 sm:grid-cols-2" height="h-28" lines={1} />
      <TableSkeleton rows={6} cols={["2.4fr", "1fr", "1fr", "1fr"]} />
    </SkeletonPage>
  );
}
