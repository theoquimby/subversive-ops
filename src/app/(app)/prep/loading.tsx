/** Loading skeleton — Prep list: a narrow column with the day switch, then the board. */

import { SkeletonPage, PageHeaderSkeleton, Bone, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <div className="mx-auto max-w-2xl">
        <PageHeaderSkeleton title="w-32" />
        <Bone className="mb-5 h-12 w-56 rounded-xl" />
        <ListSkeleton rows={6} row="h-16" />
      </div>
    </SkeletonPage>
  );
}
