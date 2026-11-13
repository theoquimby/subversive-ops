"use client";

import { GridCell } from "@/components/grid";
import { setMinOnHand } from "./actions";

export function MinOnHandCell({ id, value, unit }: { id: string; value: number | null; unit: string }) {
  return <GridCell grid="ing" col="par" type="number" value={value} suffix={value == null ? undefined : unit} placeholder={`— ${unit}`} onSave={(v) => setMinOnHand(id, v)} ariaLabel="Minimum on hand" />;
}
