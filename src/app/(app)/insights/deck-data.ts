import { evidenceOf } from "@/domain/analytics";
import type { LabAction } from "@/domain/lab";

/** What the client needs of an action (plain data). */
export type DeckAction = Pick<LabAction, "key" | "kind" | "title" | "action" | "subject" | "monthly" | "low" | "high" | "oneOff" | "confidence" | "isNew" | "href" | "how" | "inputs" | "area" | "effort" | "vector" | "story" | "visual" | "stars" | "rating" | "parts" | "alsoSeen" | "score" | "value"> & { evidence: ReturnType<typeof evidenceOf> };

export const toDeck = (a: LabAction): DeckAction => ({ key: a.key, kind: a.kind, title: a.title, action: a.action, subject: a.subject ?? null, monthly: a.monthly, low: a.low, high: a.high, oneOff: a.oneOff, confidence: a.confidence, isNew: a.isNew, href: a.href, how: a.how, inputs: a.inputs, area: a.area, effort: a.effort, vector: a.vector, story: a.story, visual: a.visual, stars: a.stars, rating: a.rating, parts: a.parts, alsoSeen: a.alsoSeen, score: a.score, value: a.value, evidence: evidenceOf(a) });

