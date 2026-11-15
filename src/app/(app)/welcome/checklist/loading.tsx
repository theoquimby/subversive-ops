/** Loading skeleton — Setup checklist: header, then two lists. */

import { ListSkeleton, PageHeaderSkeleton, SectionSkeleton, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-3xl">
      <PageHeaderSkeleton back description={1} />
      <SectionSkeleton title="w-28"><ListSkeleton rows={7} /></SectionSkeleton>
      <SectionSkeleton title="w-28"><ListSkeleton rows={4} /></SectionSkeleton>
    </SkeletonPage>
  );
}
