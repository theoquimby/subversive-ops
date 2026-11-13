/** Loading skeleton — A count sheet: a long list of items to count. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-xl">
      <PageHeaderSkeleton back title="w-40" />
      <ChipsSkeleton count={4} />
      <ListSkeleton rows={9} row="h-16" />
    </SkeletonPage>
  );
}
