/** Loading skeleton — Order builder: delivery pickers, then the suggested order lines. */

import { SkeletonPage, PageHeaderSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-52" />
      <div className="mb-6"><FormSkeleton fields={2} className="grid gap-3 sm:grid-cols-3" submit={false} /></div>
      <TableSkeleton rows={8} cols={["2.4fr", "1fr", "1fr", "1fr", "1.2fr", "0.7fr"]} row="h-[3.6rem]" phoneCols={3} />
    </SkeletonPage>
  );
}
