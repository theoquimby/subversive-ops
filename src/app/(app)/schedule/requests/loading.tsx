/** Loading skeleton — Requests: time-off and swap cards, narrow column. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, CardGridSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <PageHeaderSkeleton back title="w-32" />
      <SectionSkeleton description={false}><CardGridSkeleton count={2} className="grid gap-3" height="h-40" lines={3} /></SectionSkeleton>
    </SkeletonPage>
  );
}
