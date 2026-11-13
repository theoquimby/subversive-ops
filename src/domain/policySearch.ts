/**
 * Keyword search over uploaded policy documents — the answer path when no
 * Claude key is configured, and the way passages are picked to send to Claude
 * when one is. Never invents anything: it only returns text that is in a
 * document.
 */

export interface PolicyDoc {
  id: string;
  title: string;
  text: string;
}

export interface PolicyPassage {
  docId: string;
  title: string;
  /** Whole passage (for sending to Claude). */
  text: string;
  /** Shortened around the first match (for showing). */
  snippet: string;
  score: number;
}

const STOP = new Set(
  "a an and are as at be by can do does for from get got have how i if in is it its me my of on or our should so that the their them then there this to us was we what when where which who why will with you your am im i'm any about after before into than too also just not no yes".split(" "),
);

/** Crude stem so "breaks" ≈ "break", "scheduled" ≈ "schedule", "requesting" ≈ "request". */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ied")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
}

/** Split text into passages of roughly `size` characters on paragraph / sentence boundaries. */
export function chunkText(text: string, size = 700): string[] {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    if (p.length > size) {
      push();
      const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
      for (const s of sentences) {
        if ((cur + s).length > size) push();
        cur += s;
      }
      push();
    } else {
      if ((cur + "\n\n" + p).length > size) push();
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  push();
  return out;
}

function snippetAround(text: string, qTerms: Set<string>, max = 260): string {
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  const re = /[A-Za-z0-9]+(?:'[a-z]+)?/g;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(flat))) {
    if (qTerms.has(stem(m[0].toLowerCase()))) { at = m.index; break; }
  }
  let start = Math.max(0, at - 80);
  // Start on a word boundary.
  if (start > 0) start = flat.indexOf(" ", start) + 1 || start;
  const cut = flat.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${cut.trim()}${start + max < flat.length ? "…" : ""}`;
}

/** Best-matching passages across documents, highest score first. Empty when nothing matches. */
export function searchPolicies(docs: readonly PolicyDoc[], query: string, limit = 5): PolicyPassage[] {
  const q = [...new Set(terms(query))];
  if (q.length === 0) return [];
  const passages = docs.flatMap((d) => chunkText(d.text).map((text) => ({ doc: d, text, words: terms(text) })));
  if (passages.length === 0) return [];
  // Rarer words count for more (a plain idf), and passages matching more distinct words win.
  const df = new Map(q.map((t) => [t, passages.filter((p) => p.words.includes(t)).length]));
  const qSet = new Set(q);
  const scored = passages
    .map((p) => {
      const counts = new Map<string, number>();
      for (const w of p.words) if (qSet.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
      if (counts.size === 0) return null;
      let score = 0;
      for (const [t, c] of counts) score += (1 + Math.log(c)) * Math.log(1 + passages.length / (df.get(t) || 1));
      score *= counts.size / q.length;
      // A title match is a strong hint the whole document is about it.
      if (terms(p.doc.title).some((w) => qSet.has(w))) score *= 1.25;
      return { docId: p.doc.id, title: p.doc.title, text: p.text, snippet: snippetAround(p.text, qSet), score };
    })
    .filter((x): x is PolicyPassage => x != null)
    .sort((a, b) => b.score - a.score);
  // Drop weak matches far behind the best one (a single common word, usually).
  const top = scored[0]?.score ?? 0;
  return scored.filter((x) => x.score >= top * 0.35).slice(0, limit);
}
