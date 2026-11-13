/** Loading skeleton — Help article: breadcrumb, title, paragraphs and the topic list. */

import { SkeletonPage, TextLine } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div>
        <TextLine className="w-36" line="mb-3 h-5" />
        <TextLine className="w-72 max-w-full rounded-lg" line="h-10" bone="h-7" />
        {["w-[95%]", "w-[88%]", "w-[60%]"].map((w, i) => <TextLine key={i} className={w} line="h-7" bone="h-3.5" />)}
        <div className="my-8 border-t border-border" />
        {["w-[92%]", "w-[85%]", "w-[90%]", "w-[70%]", "w-[80%]", "w-[50%]"].map((w, i) => <TextLine key={i} className={w} line="h-6" />)}
      </div>
      <div className="hidden lg:block">{Array.from({ length: 12 }, (_, i) => <TextLine key={i} className={i % 3 ? "w-32" : "w-40"} line="h-7" />)}</div>
    </SkeletonPage>
  );
}
