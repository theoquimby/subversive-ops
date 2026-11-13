"use client";

import { GridCell, GridSelect } from "@/components/grid";
import { saveAutoApprove, saveTolerance } from "./actions";

export function ToleranceCells({ price, qty }: { price: number; qty: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="block">
        <span className="text-xs text-muted">Price</span>
        <GridCell grid="tolerance" col="price" type="number" align="left" prefix="$" decimals={2} value={price} ariaLabel="Price tolerance in dollars" onSave={(v) => saveTolerance("price", v)} className="-ml-2" />
      </label>
      <label className="block">
        <span className="text-xs text-muted">Quantity</span>
        <GridCell grid="tolerance" col="qty" type="number" align="left" value={qty} ariaLabel="Quantity tolerance" onSave={(v) => saveTolerance("qty", v)} className="-ml-2" />
      </label>
    </div>
  );
}

export function AutoApproveCell({ on }: { on: boolean }) {
  return (
    <label className="mt-2 block">
      <span className="text-xs text-muted">Auto-approve clean matches</span>
      <GridSelect
        value={on ? "on" : "off"}
        options={[{ value: "off", label: "Off — approve by hand" }, { value: "on", label: "On — PO received, all lines match" }]}
        onSave={(v) => saveAutoApprove(v === "on")}
        ariaLabel="Auto-approve clean matches"
        className="-ml-2"
      />
    </label>
  );
}
