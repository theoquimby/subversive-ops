/** Loading skeleton — Help center: search, tour cards, topic list. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, CardGridSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-5xl">
      <PageHeaderSkeleton title="w-24" />
      <Bone className="mb-8 h-11 w-full rounded-xl" />
      <SectionSkeleton><CardGridSkeleton count={6} height="h-32" /></SectionSkeleton>
    </SkeletonPage>
  );
}
