/** Loading skeleton — My shifts: a narrow column of shift cards. */

import { SkeletonPage, PageHeaderSkeleton, ListSkeleton, CardGridSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <PageHeaderSkeleton title="w-32" description={0} />
      <CardGridSkeleton count={2} className="mb-6 grid gap-3 sm:grid-cols-2" height="h-28" lines={1} />
      <ListSkeleton rows={5} row="h-16" />
    </SkeletonPage>
  );
}
