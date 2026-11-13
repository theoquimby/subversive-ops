/** Loading skeleton — Log waste: the waste form and top loggers, narrow column. */

import { SkeletonPage, PageHeaderSkeleton, FormSkeleton, SectionSkeleton, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto max-w-xl">
      <PageHeaderSkeleton title="w-32" />
      <div className="mb-10"><FormSkeleton fields={3} className="grid gap-4" /></div>
      <SectionSkeleton><ListSkeleton rows={3} row="h-10" meta={false} /></SectionSkeleton>
    </SkeletonPage>
  );
}
