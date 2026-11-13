/** Loading skeleton — Recipe drafts: intake card and draft cards. */

import { SkeletonPage, PageHeaderSkeleton, BlockSkeleton, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <PageHeaderSkeleton back title="w-48" description={2} />
      <BlockSkeleton className="mb-8 h-40" />
      <ListSkeleton rows={3} row="h-48" />
    </SkeletonPage>
  );
}
