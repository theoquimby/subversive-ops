"use client";

import { AutoInput, AutoSwitch } from "../controls";
import { saveAuto, saveFixed, savePricesOnApproveSetting, saveTax, saveTerms, saveTol } from "../setting-actions";

const num = (n: number | null | undefined) => (n == null ? "" : String(n));

export const TaxInput = ({ value }: { value: number | null }) => <AutoInput value={value == null ? "" : String(Number((value * 100).toFixed(3)))} numeric suffix="%" placeholder="Square" ariaLabel="Sales tax rate percent" className="w-28" onSave={saveTax} />;
export const PriceTolInput = ({ value }: { value: number }) => <AutoInput value={value.toFixed(2)} numeric prefix="$" ariaLabel="Price tolerance in dollars per unit" className="w-28" onSave={(v) => saveTol("price", v)} />;
export const QtyTolInput = ({ value }: { value: number }) => <AutoInput value={num(value)} numeric ariaLabel="Quantity tolerance" className="w-28" onSave={(v) => saveTol("qty", v)} />;
export const AutoApproveSwitch = ({ on }: { on: boolean }) => <AutoSwitch on={on} label="Auto-approve clean invoices" onSave={saveAuto} />;
export const PricesOnApproveSwitch = ({ on }: { on: boolean }) => <AutoSwitch on={on} label="Approving updates prices" onSave={savePricesOnApproveSetting} />;
export const TermsInput = ({ value }: { value: number }) => <AutoInput value={num(value)} numeric suffix="days" ariaLabel="Payment terms in days" className="w-32" onSave={saveTerms} />;
export const FixedInput = ({ field, value, label }: { field: "rent" | "utilities" | "insurance" | "other"; value: number | null; label: string }) => <AutoInput value={num(value)} numeric prefix="$" placeholder="0" ariaLabel={`${label} per month`} className="w-36" onSave={(v) => saveFixed(field, v)} />;
