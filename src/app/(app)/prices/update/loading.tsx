/** Loading skeleton — Update prices by hand: supplier chips and a list of price rows. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-56" />
      <ChipsSkeleton count={4} />
      <ListSkeleton rows={6} />
    </SkeletonPage>
  );
}
