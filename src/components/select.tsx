"use client";

/**
 * Custom select — no native browser menus anywhere.
 *
 * Drop-in for <select>: accepts <option>/<optgroup> children (or `options`),
 * value/defaultValue, onChange(e) with e.target.value, and `name` for forms
 * (rendered as a hidden input). Long lists get a search box. Full keyboard
 * support; on phones the list opens as a bottom sheet.
 */

import { autoUpdate, flip, offset, size, useFloating, useTransitionStyles } from "@floating-ui/react";
import { popoverTransition, sheetTransition, useReducedMotion } from "./motion";
import { cn } from "@/lib/cn";
import { Check, ChevronDown, Search } from "lucide-react";
import { Children, isValidElement, ReactElement, ReactNode, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

// One shared media-query subscription for every select on the page (tables can hold hundreds).
const PHONE_MQ = "(max-width: 639px)";
const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useIsPhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_MQ).matches, () => false);

export function Select({ value, defaultValue, onChange, options: given, children, name, placeholder = "Choose…", disabled, className, variant = "default", searchable, required, id, ...rest }: SelectProps) {
  const all = useMemo(() => given ?? optionsFromChildren(children), [given, children]);
  // A disabled empty option is a placeholder: shown on the button, never in the list.
  const options = useMemo(() => all.filter((o) => !(o.value === "" && o.disabled)), [all]);
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const selected = all.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  // The menu (floating-ui, motion, portal) mounts the first time it opens, so a
  // table full of selects only pays for buttons.
  const [menuMounted, setMenuMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();

  const show = () => { setMenuMounted(true); setOpen(true); };
  const commit = (o: SelectOption) => {
    if (o.disabled) return;
    if (value === undefined) setInner(o.value);
    onChange?.({ target: { value: o.value, name } });
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onClosedKey = (e: React.KeyboardEvent) => {
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
      return;
    }
    // Typeahead on the closed button: jump to the first option starting with the key.
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const o = options.find((x) => x.label.toLowerCase().startsWith(e.key.toLowerCase()) && !x.disabled);
      if (o) commit(o);
    }
  };

  return (
    <>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest["aria-label"]}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onClosedKey}
        className={cn(
          "inline-flex w-full min-w-0 items-center justify-between gap-2 text-left text-sm transition-[color,background-color,border-color,opacity,outline-color,outline-offset] duration-120 ease-motion disabled:opacity-50",
          variant === "default"
            ? "h-9 rounded-lg border border-border-strong bg-surface px-3 hover:border-ink-2/40 focus-visible:border-ink-2"
            : "h-10 rounded-md border border-transparent bg-transparent px-2 hover:border-border focus-visible:border-ink-2 sm:h-8",
          open && "border-ink-2",
          className,
        )}
      >
        <span className={cn("truncate", (!selected || selected.value === "") && "text-muted")}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted transition-transform duration-180 ease-motion", open && "rotate-180")} />
      </button>
      {name && <input type="hidden" name={name} value={current} required={required} />}
      {menuMounted && <Menu open={open} setOpen={setOpen} buttonRef={buttonRef} listId={listId} options={options} current={current} commit={commit} showSearch={searchable ?? options.length > 8} label={rest["aria-label"]} />}
    </>
  );
}

function Menu({ open, setOpen, buttonRef, listId, options, current, commit, showSearch, label }: { open: boolean; setOpen: (o: boolean) => void; buttonRef: React.RefObject<HTMLButtonElement | null>; listId: string; options: SelectOption[]; current: string; commit: (o: SelectOption) => void; showSearch: boolean; label?: string }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const phone = useIsPhone();
  const searchRef = useRef<HTMLInputElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    placement: "bottom-start",
    elements: { reference: buttonRef.current },
    // top/left positioning leaves `transform` free for the enter/exit scale.
    transform: false,
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

  // Menu: scale .96→1 + fade from the trigger edge. Phone sheet: slides up.
  const reduced = useReducedMotion();
  const { isMounted, styles: motion } = useTransitionStyles(context, phone ? sheetTransition(reduced) : popoverTransition(reduced));

  const filtered = useMemo(() => (query ? fuzzyFilter(options, query, (o) => `${o.label} ${o.group ?? ""}`, 200) : options), [options, query]);
  const close = () => { setOpen(false); setQuery(""); };
  const pick = (o: SelectOption) => { if (o.disabled) return; setQuery(""); commit(o); };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, filtered.findIndex((o) => o.value === current)));
    requestAnimationFrame(() => (showSearch ? searchRef.current?.focus({ preventScroll: true }) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || refs.floating.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refs.floating, buttonRef]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  const onKey = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) pick(filtered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); buttonRef.current?.focus(); }
    else if (e.key === "Tab") close();
  };
  // While open without a search box, keys still land on the button.
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const btn = buttonRef.current;
    if (!open || !btn) return;
    const h = (e: KeyboardEvent) => keyRef.current(e);
    btn.addEventListener("keydown", h);
    return () => btn.removeEventListener("keydown", h);
  }, [open, buttonRef]);

  if (!isMounted || typeof document === "undefined") return null;
  let lastGroup: string | undefined;
  return createPortal(
    <>
      {phone && <div className={cn("fixed inset-0 z-[59] bg-black/30", open ? "animate-fade-in" : "pointer-events-none animate-fade-out")} onClick={close} />}
      <div
        ref={refs.setFloating}
        style={phone ? motion : { ...floatingStyles, ...motion }}
        className={cn(
          "z-[60] flex flex-col overflow-hidden border border-border bg-surface text-sm shadow-xl",
          !open && "pointer-events-none",
          phone ? "fixed inset-x-0 bottom-0 max-h-[70dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]" : "rounded-xl",
        )}
        onKeyDown={(e) => { if (e.target !== buttonRef.current) onKey(e); }}
      >
        {phone && <div className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-border-strong" />}
        {showSearch && (
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-3.5 text-muted" />
            <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder="Search…" className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted sm:h-10 sm:text-sm" aria-label="Search options" />
          </div>
        )}
        <div role="listbox" id={listId} className="overflow-y-auto p-1" aria-label={label}>
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
                  onClick={() => pick(o)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 transition-colors duration-75",
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
    </>,
    document.body,
  );
}
