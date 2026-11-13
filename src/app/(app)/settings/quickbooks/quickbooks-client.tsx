"use client";

import { useConfirm } from "@/components/dialog";
import { Button, cx, DatePicker, Select } from "@/components/ui";
import type { SelectOption } from "@/components/select";
import type { QboAccount, QboMapping } from "@/domain/quickbooks";
import { relativeTime } from "@/lib/format";
import { ArrowRight, Check, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { TestResult } from "../connections/actions";
import { Chips } from "../square/square-client";
import {
  clearQuickBooksProblems,
  disconnectQuickBooksAction,
  linkSupplierToVendor,
  matchSuppliersToVendors,
  refreshQuickBooksLists,
  saveQuickBooksMapping,
  sendWaitingToQuickBooks,
  setQuickBooksEnvironmentAction,
  testQuickBooks,
} from "./actions";

/**
 * QuickBooks pieces shared by Settings → Connections (the guide) and
 * Settings → QuickBooks (managing it): connect, environment, test,
 * disconnect, choose accounts, suppliers ↔ vendors, and sending.
 */

type Msg = { ok: boolean; text: string } | null;

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cx("text-sm", msg.ok ? "text-good" : "text-bad")}>
      {msg.text}
    </p>
  );
}

// ---- Connect, environment, test, disconnect -------------------------------------------------

export function QboConnectButton({ back, label = "Connect to QuickBooks", disabled }: { back: "/settings/connections" | "/settings/quickbooks"; label?: string; disabled?: boolean }) {
  if (disabled) return <Button variant="primary" size="lg" disabled>{label}</Button>;
  return (
    <a href={`/api/quickbooks/oauth/start?back=${back}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-5 text-[0.95rem] font-medium text-primary-ink transition-opacity hover:opacity-90">
      {label} <ArrowRight className="size-4" />
    </a>
  );
}

export function EnvironmentPicker({ value, locked }: { value: "production" | "sandbox"; locked: boolean }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => setV(value), [value]);
  return (
    <div className="space-y-1.5">
      <Chips
        ariaLabel="Which QuickBooks"
        value={v}
        disabled={pending || locked}
        onChange={(next) => {
          const prev = v;
          setV(next);
          start(async () => {
            const r = await setQuickBooksEnvironmentAction(next);
            if (r.error) {
              setV(prev);
              setError(r.error);
            } else {
              setError(null);
              router.refresh();
            }
          });
        }}
        options={[
          { value: "production", label: "Real company" },
          { value: "sandbox", label: "Test company" },
        ]}
      />
      {locked && <p className="text-xs text-muted">Disconnect first to switch.</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function QboTestButton({ last, disabled }: { last: TestResult | null; disabled?: boolean }) {
  const [result, setResult] = useState<TestResult | null>(last);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-2.5">
      <Button variant="primary" disabled={pending || disabled} onClick={() => start(async () => { setResult(await testQuickBooks()); router.refresh(); })}>
        {pending ? "Testing…" : "Test connection"}
      </Button>
      {result && (
        <div role="status" className={cx("flex gap-2.5 rounded-lg px-3 py-2.5 text-sm", result.ok ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>
          <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white", result.ok ? "bg-good" : "bg-bad")}>
            {result.ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0">
            {result.message}
            <span className="ml-1 opacity-70">· {relativeTime(new Date(result.at))}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function QboDisconnect() {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <Button
        variant="danger"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: "Disconnect QuickBooks?",
            body: "Invoices stop going to QuickBooks until you connect again. Bills already sent stay in QuickBooks, and your account choices are kept.",
            confirmLabel: "Disconnect",
            danger: true,
          });
          if (!ok) return;
          start(async () => {
            const r = await disconnectQuickBooksAction();
            setMsg(r.note ? { ok: true, text: r.note } : null);
            router.refresh();
          });
        }}
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
      <Feedback msg={msg} />
    </div>
  );
}

// ---- Selects that save themselves --------------------------------------------------------------

function AutoSelect({ value, options, onSave, ariaLabel, placeholder, className }: { value: string; options: SelectOption[]; onSave: (v: string) => Promise<{ error?: string } | void>; ariaLabel: string; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => setV(value), [value]);
  return (
    <div className="min-w-0">
      <Select
        aria-label={ariaLabel}
        value={v}
        options={options}
        placeholder={placeholder}
        disabled={pending}
        searchable={options.length > 8}
        className={cx("w-full", pending && "opacity-60", className)}
        onChange={(e) => {
          const next = e.target.value;
          const prev = v;
          setV(next);
          start(async () => {
            const r = await onSave(next);
            if (r && r.error) {
              setV(prev);
              setError(r.error);
            } else {
              setError(null);
              router.refresh();
            }
          });
        }}
      />
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { "Cost of Goods Sold": "Cost of goods", Expense: "Expenses", "Other Expense": "Other expenses" };

export function accountOptions(accounts: readonly QboAccount[], first?: SelectOption): SelectOption[] {
  return [...(first ? [first] : []), ...accounts.map((a) => ({ value: a.id, label: a.fullName, group: TYPE_LABEL[a.type] ?? a.type }))];
}

// ---- Choose accounts ---------------------------------------------------------------------------------

export interface MappingProps {
  accounts: QboAccount[];
  accountsAt: string | null;
  mapping: QboMapping;
  categories: string[];
  /** Suggested account per category (only where one stands out). */
  suggestions: Record<string, string>;
  defaultSuggestion: string | null;
  missing: string[];
}

function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 px-4 py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-center sm:gap-4 sm:py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function AccountMapping({ accounts, accountsAt, mapping, categories, suggestions, defaultSuggestion, missing }: MappingProps) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (change: Record<string, unknown>) => saveQuickBooksMapping(change);
  const name = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.fullName ?? null;
  const toFill = categories.filter((c) => !mapping.byCategory[c] && suggestions[c] && suggestions[c] !== mapping.defaultAccountId);
  const needsDefault = !mapping.defaultAccountId;

  const refreshLists = () =>
    start(async () => {
      const r = await refreshQuickBooksLists();
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `Brought in ${r.accounts} accounts and ${r.vendors} vendors.` });
      router.refresh();
    });

  if (!accounts.length) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">{accountsAt ? "QuickBooks didn't list any cost of goods or expense accounts. Add one in QuickBooks, then refresh." : "The list of accounts hasn't come in from QuickBooks yet."}</p>
        <Button disabled={pending} onClick={refreshLists}><RefreshCw className={cx("size-4", pending && "animate-spin")} />{pending ? "Getting the list…" : "Get the list from QuickBooks"}</Button>
        <Feedback msg={msg} />
      </div>
    );
  }

  const sameAsDefault = { value: "", label: `Same as above${name(mapping.defaultAccountId) ? ` (${name(mapping.defaultAccountId)})` : ""}` };
  return (
    <div className="space-y-3">
      {missing.length > 0 && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2.5 text-sm text-bad">{missing.length === 1 ? "One account picked here" : `${missing.length} accounts picked here`} no longer exist in QuickBooks. Pick again below.</p>}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <Row label="Bills go to" hint="Everything not picked below">
          <AutoSelect
            ariaLabel="Account bills go to"
            value={mapping.defaultAccountId ?? ""}
            placeholder={defaultSuggestion ? `Pick one — e.g. ${name(defaultSuggestion)}` : "Pick an account"}
            options={accountOptions(accounts)}
            onSave={(v) => save({ field: "defaultAccountId", value: v || null })}
            className={needsDefault ? "border-warn/60" : undefined}
          />
        </Row>
        {categories.map((c) => (
          <Row key={c} label={c} hint={suggestions[c] && !mapping.byCategory[c] ? `Suggested: ${name(suggestions[c])}` : undefined}>
            <AutoSelect ariaLabel={`Account for ${c}`} value={mapping.byCategory[c] ?? ""} options={accountOptions(accounts, sameAsDefault)} onSave={(v) => save({ field: "category", key: c, value: v || null })} />
          </Row>
        ))}
        <Row label="Fees, tax, delivery" hint="When the lines don't add up to the total">
          <AutoSelect ariaLabel="Account for fees, tax and delivery" value={mapping.otherAccountId ?? ""} options={accountOptions(accounts, sameAsDefault)} onSave={(v) => save({ field: "otherAccountId", value: v || null })} />
        </Row>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(toFill.length > 0 || (needsDefault && defaultSuggestion)) && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (needsDefault && defaultSuggestion) await save({ field: "defaultAccountId", value: defaultSuggestion });
                for (const c of toFill) await save({ field: "category", key: c, value: suggestions[c] });
                router.refresh();
              })
            }
          >
            <Check className="size-4" />Use the suggestions
          </Button>
        )}
        <Button variant="ghost" disabled={pending} onClick={refreshLists}><RefreshCw className={cx("size-4", pending && "animate-spin")} />Refresh list</Button>
        {accountsAt && <span className="text-xs text-muted">List from QuickBooks {relativeTime(new Date(accountsAt))}</span>}
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

// ---- Suppliers ↔ vendors ------------------------------------------------------------------------------

export interface SupplierRow {
  supplierId: string;
  supplierName: string;
  vendorId: string | null;
  vendorName: string | null;
  suggestion: { id: string; name: string } | null;
  accountId: string | null;
}

export function SupplierVendors({ rows, vendors, accounts, defaultAccountName }: { rows: SupplierRow[]; vendors: { id: string; name: string }[]; accounts: QboAccount[]; defaultAccountName: string | null }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const unmatched = rows.filter((r) => !r.vendorId && r.suggestion).length;
  const vendorOptions = (r: SupplierRow): SelectOption[] => {
    const known = r.vendorId && !vendors.some((v) => v.id === r.vendorId) ? [{ value: r.vendorId, label: r.vendorName ?? "Linked vendor" }] : [];
    return [
      { value: "", label: "Match or create when first sent" },
      { value: "new", label: `Create “${r.supplierName}” in QuickBooks` },
      ...(r.suggestion && !r.vendorId ? [{ value: r.suggestion.id, label: r.suggestion.name, hint: "looks like a match", group: "Suggested" }] : []),
      ...known,
      ...vendors.map((v) => ({ value: v.id, label: v.name, group: "QuickBooks vendors" })),
    ];
  };
  return (
    <div className="space-y-3">
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        <div className="hidden grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)] gap-4 px-4 py-2 text-[0.8rem] font-medium text-muted md:grid">
          <span>Supplier</span>
          <span>QuickBooks vendor</span>
          <span>Account for this supplier</span>
        </div>
        {rows.map((r) => (
          <div key={r.supplierId} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4 md:py-2.5">
            <div className="min-w-0 truncate text-sm font-medium">{r.supplierName}</div>
            <AutoSelect ariaLabel={`QuickBooks vendor for ${r.supplierName}`} value={r.vendorId ?? ""} options={vendorOptions(r)} onSave={(v) => linkSupplierToVendor(r.supplierId, v)} />
            <AutoSelect
              ariaLabel={`Account for ${r.supplierName}`}
              value={r.accountId ?? ""}
              options={accountOptions(accounts, { value: "", label: `Usual (${defaultAccountName ?? "Bills go to"})` })}
              onSave={(v) => saveQuickBooksMapping({ field: "supplier", key: r.supplierId, value: v || null })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {unmatched > 0 && (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await matchSuppliersToVendors();
                setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.matched ? `Matched ${r.matched} supplier${r.matched === 1 ? "" : "s"} by name.` : "No exact name matches — pick the vendor for each one above, or leave it to be created when first sent." });
                router.refresh();
              })
            }
          >
            Match by name
          </Button>
        )}
      </div>
      <Feedback msg={msg} />
    </div>
  );
}

// ---- Sending --------------------------------------------------------------------------------------------

export function SendOptions({ autoSend, sendFrom, waiting, ready }: { autoSend: boolean; sendFrom: string; waiting: number; ready: boolean }) {
  const [on, setOn] = useState(autoSend);
  const [from, setFrom] = useState(sendFrom);
  const [msg, setMsg] = useState<Msg>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => setOn(autoSend), [autoSend]);
  useEffect(() => setFrom(sendFrom), [sendFrom]);

  const sendAll = () =>
    start(async () => {
      setMsg(null);
      let sent = 0;
      let failed = 0;
      let error: string | undefined;
      for (let round = 0; round < 40; round++) {
        setProgress(`Sending… ${sent} sent so far`);
        const r = await sendWaitingToQuickBooks();
        sent += r.sent;
        failed += r.failed;
        error ??= r.error;
        if (!r.remaining || (!r.sent && r.failed) || (r.error && !r.sent)) break;
      }
      setProgress(null);
      setMsg(failed ? { ok: false, text: `Sent ${sent}. ${failed} couldn't be sent${error ? `: ${error}` : "."}` } : { ok: true, text: sent ? `Sent ${sent} invoice${sent === 1 ? "" : "s"} to QuickBooks.` : "Nothing was waiting." });
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Send automatically when approved</div>
          <div className="text-xs text-muted">Each invoice goes over as a bill the moment it&apos;s approved.</div>
        </div>
        <Chips
          ariaLabel="Send automatically"
          value={on ? "on" : "off"}
          disabled={pending || !ready}
          onChange={(v) => {
            const next = v === "on";
            setOn(next);
            start(async () => {
              const r = await saveQuickBooksMapping({ field: "autoSend", value: next });
              if (r.error) {
                setOn(!next);
                setMsg({ ok: false, text: r.error });
              } else router.refresh();
            });
          }}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Send invoices dated from</div>
          <div className="text-xs text-muted">Older ones are left out, so bills already typed into QuickBooks aren&apos;t doubled.</div>
        </div>
        <DatePicker
          value={from}
          aria-label="Send invoices dated from"
          className="w-44"
          onChange={(e) => {
            const v = e.target.value;
            setFrom(v);
            start(async () => {
              const r = await saveQuickBooksMapping({ field: "sendFrom", value: v || null });
              if (r.error) setMsg({ ok: false, text: r.error });
              router.refresh();
            });
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2/70 px-3.5 py-3">
        <span className="min-w-0 flex-1 text-sm">
          {waiting ? <><b className="num">{waiting}</b> approved invoice{waiting === 1 ? " is" : "s are"} waiting to go to QuickBooks.</> : "Every approved invoice from that date is in QuickBooks."}
        </span>
        {waiting > 0 && (
          <Button variant="primary" disabled={pending || !ready} onClick={sendAll}>
            {pending && progress ? progress : `Send ${waiting === 1 ? "it" : `all ${waiting}`}`}
          </Button>
        )}
      </div>
      {!ready && <p className="text-sm text-warn">Pick where bills go first (Bills go to, above).</p>}
      <Feedback msg={msg} />
    </div>
  );
}

export function ClearProblems() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await clearQuickBooksProblems(); router.refresh(); })}>
      Clear
    </Button>
  );
}
