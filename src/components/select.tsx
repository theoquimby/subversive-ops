"use client";

/**
 * Custom select — no native browser menus anywhere.
 *
 * Drop-in for <select>: accepts <option>/<optgroup> children (or `options`),
 * value/defaultValue, onChange(e) with e.target.value, and `name` for forms
 * (rendered as a hidden input). Long lists get a search box. Full keyboard
 * support; on phones the list opens as a bottom sheet.
 */

import { autoUpdate, flip, offset, size, useFloating } from "@floating-ui/react";
import clsx from "clsx";
import { Check, ChevronDown, Search } from "lucide-react";
import { Children, isValidElement, ReactElement, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fuzzyFilter } from "@/domain/search";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
  hint?: string;
}

type ChangeEvent = { target: { value: string; name?: string } };

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent) => void;
  options?: SelectOption[];
  children?: ReactNode;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Visual size: default matches Input (h-9); "cell" is borderless for tables. */
  variant?: "default" | "cell";
  searchable?: boolean;
  "aria-label"?: string;
  required?: boolean;
  id?: string;
}

/** Read <option>/<optgroup> children into options so existing markup keeps working. */
function optionsFromChildren(children: ReactNode, group?: string): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string; label?: string; children?: ReactNode; disabled?: boolean }>;
    if (el.type === "optgroup") out.push(...optionsFromChildren(el.props.children, el.props.label));
    else if (el.type === "option") {
      const text = Children.toArray(el.props.children).join("");
      out.push({ value: el.props.value ?? text, label: text, group, disabled: el.props.disabled });
    }
  });
  return out;
}

const useIsPhone = () => {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const set = () => setPhone(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  return phone;
};

export function Select({ value, defaultValue, onChange, options: given, children, name, placeholder = "Choose…", disabled, className, variant = "default", searchable, required, id, ...rest }: SelectProps) {
  const all = useMemo(() => given ?? optionsFromChildren(children), [given, children]);
  // A disabled empty option is a placeholder: shown on the button, never in the list.
  const options = useMemo(() => all.filter((o) => !(o.value === "" && o.disabled)), [all]);
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const selected = all.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const phone = useIsPhone();
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const showSearch = searchable ?? options.length > 8;

  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, { minWidth: `${Math.max(rects.reference.width, 180)}px`, maxHeight: `${Math.min(360, availableHeight)}px` });
        },
      }),
    ],
  });

  const filtered = useMemo(() => (query ? fuzzyFilter(options, query, (o) => `${o.label} ${o.group ?? ""}`, 200) : options), [options, query]);

  const commit = (o: SelectOption) => {
    if (o.disabled) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value, name } });
    setOpen(false);
    setQuery("");
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, filtered.findIndex((o) => o.value === current)));
    requestAnimationFrame(() => (showSearch ? searchRef.current?.focus() : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || refs.floating.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, refs.floating]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) {
      // Typeahead on the closed button: jump to the first option starting with the key.
      if (e.key.length === 1 && /\S/.test(e.key)) {
        const o = options.find((x) => x.label.toLowerCase().startsWith(e.key.toLowerCase()) && !x.disabled);
        if (o) commit(o);
      }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) commit(filtered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); buttonRef.current?.focus(); }
    else if (e.key === "Tab") { setOpen(false); setQuery(""); }
  };

  let lastGroup: string | undefined;
  const list = (
    <div
      ref={refs.setFloating}
      style={phone ? undefined : floatingStyles}
      className={clsx(
        "z-[60] flex flex-col overflow-hidden border border-border bg-surface text-sm shadow-xl",
        phone ? "fixed inset-x-0 bottom-0 max-h-[70dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]" : "rounded-xl",
      )}
      onKeyDown={onKey}
    >
      {phone && <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-border-strong" />}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-3.5 text-muted" />
          <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder="Search…" className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted sm:h-10 sm:text-sm" aria-label="Search options" />
        </div>
      )}
      <div role="listbox" id={listId} className="overflow-y-auto p-1" aria-label={rest["aria-label"]}>
        {filtered.length === 0 && <div className="px-3 py-6 text-center text-muted">No matches</div>}
        {filtered.map((o, i) => {
          const header = !query && o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <div key={`${o.group ?? ""}-${o.value}`}>
              {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted">{header}</div>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled}
                onMouseMove={() => setActive(i)}
                onClick={() => commit(o)}
                className={clsx(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5",
                  phone ? "min-h-11" : "min-h-8",
                  i === active && "bg-surface-2",
                  o.disabled && "cursor-default opacity-40",
                  o.value === "" && "text-muted",
                )}
              >
                <span className="truncate">{o.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                  {o.value === current && <Check className="size-3.5 text-ink" strokeWidth={2.5} />}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        id={id}
        ref={(el) => { buttonRef.current = el; refs.setReference(el); }}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest["aria-label"]}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className={clsx(
          "inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-sm transition-colors disabled:opacity-50",
          variant === "default"
            ? "h-9 rounded-lg border border-border-strong bg-surface px-3 hover:border-ink-2/40 focus-visible:border-ink-2"
            : "h-10 rounded-md border border-transparent bg-transparent px-2 hover:border-border focus-visible:border-ink-2 sm:h-8",
          open && "border-ink-2",
          className,
        )}
      >
        <span className={clsx("truncate", (!selected || selected.value === "") && "text-muted")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={clsx("size-3.5 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open && typeof document !== "undefined" && createPortal(
        <>
          {phone && <div className="fixed inset-0 z-[59] bg-black/30" onClick={() => { setOpen(false); setQuery(""); }} />}
          {list}
        </>,
        document.body,
      )}
    </>
  );
}
