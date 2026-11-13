/** Loading skeleton — Tips: the pool form, then the split table. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton title="w-16" description={2} />
      <div className="mb-10"><FormSkeleton fields={4} className="grid gap-3 sm:grid-cols-4" submit={false} /></div>
      <SectionSkeleton action><TableSkeleton rows={8} cols={["2fr", "1fr", "1fr", "1fr", "1fr"]} row="h-[3.1rem]" /></SectionSkeleton>
    </SkeletonPage>
  );
}
