/** Loading skeleton — Me: documents and training lists. */

import { SkeletonPage, PageHeaderSkeleton, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-2xl">
      <PageHeaderSkeleton title="w-24" />
      <ListSkeleton rows={3} row="h-16" className="mb-10" />
      <ListSkeleton rows={4} row="h-16" />
    </SkeletonPage>
  );
}
