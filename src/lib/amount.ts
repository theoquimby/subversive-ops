/**
 * A number the way people type it: "$12.50", "1,200", "12.5k", "1/2",
 * "1 1/2", "½", "30%" (→ 30), "(40)" (→ -40). Null when it isn't a number.
 * Safe on server and client; every amount box and action can use it.
 */
const UNICODE: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

export function parseAmount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = (raw ?? "").trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1).trim(); }
  s = s.replace(/[$\s,]/g, (m) => (m === " " ? " " : "")).replace(/%$/, "").trim();
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1).trim(); }
  // "1½", "½"
  const uni = /^(\d*)\s*([½¼¾⅓⅔⅛])$/.exec(s);
  if (uni) return sign * ((uni[1] ? Number(uni[1]) : 0) + UNICODE[uni[2]]);
  // "1 1/2", "1/2"
  const frac = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const den = Number(frac[3]);
    if (!den) return null;
    return sign * ((frac[1] ? Number(frac[1]) : 0) + Number(frac[2]) / den);
  }
  // "12.5k"
  const k = /^(\d*\.?\d+)\s*k$/i.exec(s);
  if (k) return sign * Number(k[1]) * 1000;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s.replace(/\s/g, ""))) return null;
  const n = Number(s.replace(/\s/g, ""));
  return Number.isFinite(n) ? sign * n : null;
}
