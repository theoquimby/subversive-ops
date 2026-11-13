import type { Ranked } from "@/domain/analytics";
import type { FeedRowItem } from "./client";

/** A ranked finding as the client list needs it (plain data only). */
export const toRow = (r: Ranked): FeedRowItem => ({ key: r.key, kind: r.kind, title: r.title, action: r.action, subject: r.subject ?? null, monthly: r.monthly, low: r.low, high: r.high, oneOff: r.oneOff, confidence: r.confidence, isNew: r.isNew, href: r.href, how: r.how, inputs: r.inputs });
