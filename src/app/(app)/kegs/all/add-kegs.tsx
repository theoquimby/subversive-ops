"use client";

import { Button, Card, Field, Input, LinkButton, Select } from "@/components/ui";
import { KEG_SIZE_LIST, OWNER_LABEL, type KegOwner } from "@/domain/kegs";
import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addKegs } from "../actions";

/** Add N new kegs, then print their stickers. */
export function AddKegs({ areas }: { areas: string[] }) {
  const router = useRouter();
  const [count, setCount] = useState("6");
  const [sizeId, setSizeId] = useState("half");
  const [owner, setOwner] = useState<KegOwner>("OURS");
  const [area, setArea] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-4" data-tour="kegs.add">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
        <Field label="How many"><Input type="number" inputMode="numeric" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="Size"><Select value={sizeId} onChange={(e) => setSizeId(e.target.value)} options={KEG_SIZE_LIST.map((s) => ({ value: s.id, label: s.label }))} /></Field>
        <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value as KegOwner)} options={(Object.keys(OWNER_LABEL) as KegOwner[]).map((o) => ({ value: o, label: OWNER_LABEL[o] }))} /></Field>
        <Field label="Where they are"><Select value={area} onChange={(e) => setArea(e.target.value)} options={[{ value: "", label: "Not set" }, ...areas.map((a) => ({ value: a, label: a }))]} /></Field>
        <Button variant="primary" className="col-span-2 h-10 sm:col-span-1" disabled={pending} onClick={() => start(async () => {
          setErr(null);
          const r = await addKegs({ count: Number(count), sizeId, owner, area: area || null });
          if ("error" in r) setErr(r.error);
          else { setCodes(r.codes); router.refresh(); }
        })}>{pending ? "Adding…" : "Add kegs"}</Button>
      </div>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
      {codes && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-good-bg px-4 py-3 text-sm text-good">
          <span className="font-medium">Added {codes.length} keg{codes.length === 1 ? "" : "s"}.</span>
          <LinkButton href={`/print/kegs?codes=${codes.join(",")}`} size="sm" className="h-10 sm:h-8"><Printer className="size-4" /> Print their labels</LinkButton>
        </div>
      )}
    </Card>
  );
}
