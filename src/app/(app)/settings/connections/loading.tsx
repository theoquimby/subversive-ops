/** Loading skeleton — Connections: header, six even service cards, then the guide panel. */

import { BlockSkeleton, CardGridSkeleton, PageHeaderSkeleton, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-40" description={2} />
      <CardGridSkeleton count={6} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" height="h-52" lines={3} />
      <BlockSkeleton className="mt-6 h-72" />
    </SkeletonPage>
  );
}
