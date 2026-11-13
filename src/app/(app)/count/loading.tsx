/** Loading skeleton — Counts: area buttons and recent counts, narrow column. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, ListSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-xl">
      <PageHeaderSkeleton title="w-44" />
      <SectionSkeleton description={false}>
        <div className="grid grid-cols-2 gap-2">{Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-14 rounded-xl" />)}</div>
      </SectionSkeleton>
      <SectionSkeleton description={false}><ListSkeleton rows={3} row="h-11" meta={false} /></SectionSkeleton>
    </SkeletonPage>
  );
}
