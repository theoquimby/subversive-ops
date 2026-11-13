/** Loading skeleton — An invoice: photo on the left, details and lines on the right. */

import { SkeletonPage, PageHeaderSkeleton, BlockSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-72" actions={2} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <BlockSkeleton className="h-[28rem]" />
        <div className="space-y-6">
          <FormSkeleton fields={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" submit={false} />
          <TableSkeleton rows={4} cols={["2fr", "0.5fr", "1fr", "0.6fr"]} row="h-[3.4rem]" />
        </div>
      </div>
    </SkeletonPage>
  );
}
