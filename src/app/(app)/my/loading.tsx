/** Loading skeleton — Today (staff home): greeting, the next-shift card, to-dos and the quick-action grid. */

import { Bone, SkeletonPage, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto flex max-w-xl flex-col gap-7">
      <div>
        <Bone className="h-3.5 w-36" />
        <Bone className="mt-2 h-7 w-56" />
      </div>
      <Bone className="h-52 rounded-[1.4rem]" />
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }, (_, i) => <Bone key={i} className="h-[5.75rem] rounded-2xl" />)}
      </div>
      <ListSkeleton rows={2} row="h-16" />
    </SkeletonPage>
  );
}
