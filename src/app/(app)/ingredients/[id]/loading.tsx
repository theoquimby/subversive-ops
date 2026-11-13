/** Loading skeleton — An ingredient: bought-as, cost chart and the details form. */

import { SkeletonPage, PageHeaderSkeleton, SectionSkeleton, ListSkeleton, BlockSkeleton, FormSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-40" />
      <div className="grid gap-x-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionSkeleton><ListSkeleton rows={1} row="h-20" /></SectionSkeleton>
          <SectionSkeleton><BlockSkeleton className="h-52" /></SectionSkeleton>
        </div>
        <div className="lg:col-span-2"><FormSkeleton fields={8} className="grid grid-cols-2 gap-3" /></div>
      </div>
    </SkeletonPage>
  );
}
