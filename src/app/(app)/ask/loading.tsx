/** Loading skeleton — Ask: suggestion chips and the question box. */

import { SkeletonPage, PageHeaderSkeleton, ChipsSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-20" description={2} />
      <div className="mx-auto max-w-3xl">
        <ChipsSkeleton count={7} className="mb-6" />
        <Bone className="h-12 w-full rounded-xl" />
      </div>
    </SkeletonPage>
  );
}
