/** Loading skeleton — Draft beer: the keg form, then kegs on file. */

import { SkeletonPage, PageHeaderSkeleton, FormSkeleton, SectionSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-32" description={2} />
      <div className="mb-10"><FormSkeleton fields={8} className="grid grid-cols-2 gap-3 sm:grid-cols-4" /></div>
      <SectionSkeleton><TableSkeleton rows={3} /></SectionSkeleton>
    </SkeletonPage>
  );
}
