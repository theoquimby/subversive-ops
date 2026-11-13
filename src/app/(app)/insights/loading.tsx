/** Loading skeleton — Insights: the top-5 list, then two columns of model cards of equal height. */

import { Bone, CardGridSkeleton, ListSkeleton, PageHeaderSkeleton, SectionSkeleton, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-32" actions={1} />
      <SectionSkeleton title="w-44">
        <ListSkeleton rows={5} row="h-[7.5rem]" />
      </SectionSkeleton>
      <SectionSkeleton title="w-28">
        <CardGridSkeleton count={6} className="grid gap-4 lg:grid-cols-2" height="h-[22rem]" lines={3} />
      </SectionSkeleton>
      <Bone className="h-3 w-2/3" />
    </SkeletonPage>
  );
}
