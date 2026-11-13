/** Loading skeleton — New invoice: drop zone and header fields, then lines. */

import { SkeletonPage, PageHeaderSkeleton, FormSkeleton, SectionSkeleton, TableSkeleton, Bone } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-36" description={2} />
      <div className="mb-10 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4"><Bone className="h-16 rounded-xl" /><Bone className="h-20 rounded-xl" /></div>
        <FormSkeleton fields={5} className="grid grid-cols-2 gap-3" submit={false} />
      </div>
      <SectionSkeleton><TableSkeleton rows={6} cols={["0.8fr", "3fr", "0.6fr", "1fr", "1fr"]} /></SectionSkeleton>
    </SkeletonPage>
  );
}
