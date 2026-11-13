/** Loading skeleton — Insights Lab: today's one thing, the queue, then two columns of Lab tiles. */

import { Bone, CardGridSkeleton, ListSkeleton, PageHeaderSkeleton, SectionSkeleton, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-40" actions={1} />
      <SectionSkeleton title="w-32">
        <Bone className="h-[26rem] w-full rounded-2xl sm:h-[22rem]" />
      </SectionSkeleton>
      <SectionSkeleton title="w-20">
        <ListSkeleton rows={4} row="h-[4.5rem]" />
      </SectionSkeleton>
      <SectionSkeleton title="w-24">
        <CardGridSkeleton count={4} className="grid gap-4 lg:grid-cols-2" height="h-[20rem]" lines={3} />
      </SectionSkeleton>
    </SkeletonPage>
  );
}
