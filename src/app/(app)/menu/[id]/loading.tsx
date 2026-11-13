/** Loading skeleton — Recipe editor: cost stats, ingredient lines and the details panel. */

import { SkeletonPage, PageHeaderSkeleton, StatRowSkeleton, ListSkeleton, FormSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-64" description={0} />
      <StatRowSkeleton className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" />
      <div className="mb-10 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ListSkeleton rows={4} row="h-14" />
        <FormSkeleton fields={6} className="grid grid-cols-2 gap-3" submit={false} />
      </div>
    </SkeletonPage>
  );
}
