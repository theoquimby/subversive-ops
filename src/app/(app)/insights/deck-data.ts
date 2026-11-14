import { evidenceOf, type PriceFit } from "@/domain/analytics";
import type { LabAction } from "@/domain/lab";

/** The price model's fit for an item, when the action is a price move (drives the profit curve). */
export type FitLite = Pick<PriceFit, "price" | "unitCost" | "qtyMonth" | "elasticity" | "sd" | "source">;

/** What the client needs of an action (plain data). */
export type DeckAction = Pick<LabAction, "key" | "kind" | "title" | "action" | "subject" | "monthly" | "low" | "high" | "oneOff" | "confidence" | "isNew" | "href" | "how" | "inputs" | "area" | "effort" | "vector" | "story" | "visual" | "stars" | "rating" | "parts" | "alsoSeen" | "score" | "value"> & { evidence: ReturnType<typeof evidenceOf>; fit?: FitLite | null };

const PRICE_KINDS = ["price.test", "menu.reprice"];

export const toDeck = (a: LabAction, ctx?: { fits?: PriceFit[] }): DeckAction => {
  const f = PRICE_KINDS.some((k) => a.kind === k || a.kind.startsWith(`${k}.`)) && a.subject ? ctx?.fits?.find((x) => x.id === a.subject) : undefined;
  return {
    key: a.key, kind: a.kind, title: a.title, action: a.action, subject: a.subject ?? null, monthly: a.monthly, low: a.low, high: a.high, oneOff: a.oneOff, confidence: a.confidence, isNew: a.isNew, href: a.href, how: a.how, inputs: a.inputs, area: a.area, effort: a.effort, vector: a.vector, story: a.story, visual: a.visual, stars: a.stars, rating: a.rating, parts: a.parts, alsoSeen: a.alsoSeen, score: a.score, value: a.value,
    evidence: evidenceOf(a),
    fit: f ? { price: f.price, unitCost: f.unitCost, qtyMonth: f.qtyMonth, elasticity: f.elasticity, sd: f.sd, source: f.source } : null,
  };
};
