"use server";

import { parseISODate } from "@/domain/dates";
import { parseClockTime } from "@/domain/events";
import { isBarKind, isEventType, isStage, parseConfig, reminderText, STAGE_LABEL, type PrivateEventConfig } from "@/domain/privateEvents";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { button, esc, h1, link, p, shell, small, textLines } from "@/server/email/layout";
import { emailReady, isEmail, sendEmail } from "@/server/integrations/email";
import { createQuickPayLink } from "@/server/integrations/square-checkout";
import { friendlySquareError } from "@/server/integrations/square-http";
import {
  createInquiry,
  deletePayment,
  deletePrivateEvent,
  ensureQuoteToken,
  getPrivateEvent,
  getPrivateEventConfig,
  markQuoteSent,
  moveStage,
  recordPayment,
  savePrivateEventConfig,
  syncCalendar,
} from "@/server/services/privateEvents";
import { publicOrigin } from "@/server/services/public-url";
import { businessToday } from "@/server/services/sales";
import { getBusinessContact } from "@/server/services/settings";
import { requireSquareClient, SquareNotConnectedError } from "@/server/services/square";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type R = Promise<{ error?: string; message?: string }>;
type Saved = Promise<{ error?: string } | void>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const D = (n: number) => new Prisma.Decimal(n);

function refresh(id?: string) {
  revalidatePath("/events/private");
  if (id) revalidatePath(`/events/private/${id}`);
  revalidatePath("/events");
  revalidatePath("/");
}

/** "$1,250.50" / "1250" → 1250.5; "" → null; junk → undefined. */
function parseMoney(raw: string): number | null | undefined {
  const s = raw.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : undefined;
}
/** "20" / "20%" / "8.875" → 0.2 / 0.2 / 0.08875. */
function parsePct(raw: string, max = 100): number | null | undefined {
  const s = raw.replace(/[%\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 10000 : undefined;
}
function parseDate(raw: string): Date | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseISODate(s) : undefined;
}

// ---- New inquiry ----------------------------------------------------------------------

const inquirySchema = z.object({
  clientName: z.string().trim().min(1, "Who's it for?").max(120),
  company: z.string().trim().max(120).optional().default(""),
  contact: z.string().trim().max(160).optional().default(""),
  date: isoDate.or(z.literal("")).optional().default(""),
  headcount: z.string().trim().max(6).optional().default(""),
  type: z.string().optional().default("PARTY"),
  space: z.string().max(60).optional().default(""),
  notes: z.string().max(2000).optional().default(""),
});

export async function addInquiry(input: z.input<typeof inquirySchema>): Promise<{ error?: string; id?: string }> {
  const me = await requireUser("MANAGER");
  const v = inquirySchema.safeParse(input);
  if (!v.success) return { error: v.error.issues[0]?.message ?? "Check the fields." };
  const d = v.data;
  const head = d.headcount ? Number(d.headcount.replace(/[^\d]/g, "")) : 0;
  if (!Number.isFinite(head) || head > 5000) return { error: "Headcount is a number of guests." };
  // One box for email or phone: whichever it looks like.
  const email = isEmail(d.contact) ? d.contact : null;
  const phone = !email && d.contact ? d.contact : null;
  const id = await createInquiry({
    clientName: d.clientName,
    company: d.company || null,
    clientEmail: email,
    clientPhone: phone,
    date: d.date || null,
    headcount: head,
    type: isEventType(d.type) ? d.type : "PARTY",
    space: d.space || null,
    notes: d.notes || null,
    ownerId: me.userId,
  });
  refresh();
  return { id };
}

// ---- Fields ---------------------------------------------------------------------------

const FIELDS = [
  "clientName", "company", "clientEmail", "clientPhone", "type", "date", "startTime", "endTime", "space", "headcount", "ownerId", "notes", "followUpOn",
  "roomFee", "barKind", "drinkTickets", "ticketPrice", "barAmount", "serviceChargePct", "taxPct", "depositPct", "depositAmount", "depositDueOn", "balanceDueOn", "quoteNote", "lostReason",
] as const;
export type PrivateEventField = (typeof FIELDS)[number];

export async function setPrivateEventField(id: string, field: PrivateEventField, raw: string): Saved {
  await requireUser("MANAGER");
  if (!(FIELDS as readonly string[]).includes(field)) return { error: "Unknown field" };
  const value = raw.trim();
  let data: Prisma.PrivateEventUpdateInput;
  switch (field) {
    case "clientName":
      if (!value) return { error: "Can't be empty" };
      data = { clientName: value.slice(0, 120) };
      break;
    case "company":
    case "clientPhone":
    case "notes":
    case "quoteNote":
    case "lostReason":
      data = { [field]: value ? value.slice(0, field === "notes" || field === "quoteNote" ? 2000 : 160) : null };
      break;
    case "clientEmail":
      if (value && !isEmail(value)) return { error: "That email doesn't look right" };
      data = { clientEmail: value || null };
      break;
    case "type":
      if (!isEventType(value)) return { error: "Pick a type" };
      data = { type: value };
      break;
    case "space": {
      const cfg = await getPrivateEventConfig();
      if (value && !cfg.spaces.some((s) => s.name === value)) return { error: "Pick a space" };
      data = { space: value || null };
      break;
    }
    case "ownerId":
      if (value && !(await db.user.findUnique({ where: { id: value }, select: { id: true } }))) return { error: "Pick someone" };
      data = { owner: value ? { connect: { id: value } } : { disconnect: true } };
      break;
    case "date":
    case "followUpOn":
    case "depositDueOn":
    case "balanceDueOn": {
      const d = parseDate(value);
      if (d === undefined) return { error: "Pick a date" };
      data = { [field]: d };
      break;
    }
    case "startTime":
    case "endTime": {
      const t = parseClockTime(value);
      if (t === undefined) return { error: "Use a time like 6pm or 18:30" };
      data = { [field]: t };
      break;
    }
    case "headcount":
    case "drinkTickets": {
      const n = value === "" ? 0 : Number(value.replace(/,/g, ""));
      if (!Number.isInteger(n) || n < 0 || n > 10000) return { error: "A whole number" };
      data = { [field]: n };
      break;
    }
    case "roomFee":
    case "ticketPrice":
    case "barAmount": {
      const n = parseMoney(value);
      if (n === undefined) return { error: "An amount, like 250" };
      data = { [field]: D(n ?? 0) };
      break;
    }
    case "depositAmount": {
      const n = parseMoney(value);
      if (n === undefined) return { error: "An amount, or blank to use the percent" };
      data = { depositAmount: n == null ? null : D(n) };
      break;
    }
    case "serviceChargePct":
    case "taxPct":
    case "depositPct": {
      const n = parsePct(value);
      if (n === undefined) return { error: "A percent, like 20" };
      data = { [field]: D(n ?? 0) };
      break;
    }
    case "barKind":
      if (!isBarKind(value)) return { error: "Pick a bar option" };
      data = { barKind: value };
      break;
  }
  await db.privateEvent.update({ where: { id }, data });
  await syncCalendar(id);
  refresh(id);
}

export async function setStage(id: string, stage: string): R {
  await requireUser("MANAGER");
  if (!isStage(stage)) return { error: "Unknown stage" };
  const r = await moveStage(id, stage);
  refresh(id);
  return r.error ? r : { message: `Moved to ${STAGE_LABEL[stage].toLowerCase()}.` };
}

export async function removePrivateEvent(id: string): Promise<{ error?: string }> {
  await requireUser("MANAGER");
  await deletePrivateEvent(id);
  refresh();
  return {};
}

// ---- Quote lines ----------------------------------------------------------------------

const lineSchema = z.object({ kind: z.enum(["ITEM", "PACKAGE", "CUSTOM"]), refId: z.string().max(40).optional(), label: z.string().max(120).optional() });

export async function addQuoteLine(id: string, input: z.input<typeof lineSchema>): R {
  await requireUser("MANAGER");
  const v = lineSchema.safeParse(input);
  if (!v.success) return { error: "Pick something to add." };
  const { kind, refId, label } = v.data;
  const sort = ((await db.privateEventLine.aggregate({ where: { privateEventId: id }, _max: { sort: true } }))._max.sort ?? 0) + 1;
  if (kind === "ITEM") {
    const r = refId ? await db.recipe.findUnique({ where: { id: refId }, select: { id: true, name: true, menuPrice: true } }) : null;
    if (!r) return { error: "That menu item is gone." };
    await db.privateEventLine.create({ data: { privateEventId: id, kind, recipeId: r.id, label: r.name, qty: D(1), perPerson: true, unitPrice: r.menuPrice ?? D(0), sort } });
  } else if (kind === "PACKAGE") {
    const pk = refId ? await db.privateEventPackage.findUnique({ where: { id: refId } }) : null;
    if (!pk) return { error: "That package is gone." };
    await db.privateEventLine.create({ data: { privateEventId: id, kind, packageId: pk.id, label: pk.name, qty: D(1), perPerson: true, unitPrice: pk.pricePerPerson, sort } });
  } else {
    const l = (label ?? "").trim();
    if (!l) return { error: "Name the line." };
    await db.privateEventLine.create({ data: { privateEventId: id, kind, label: l.slice(0, 120), qty: D(1), perPerson: false, unitPrice: D(0), sort } });
  }
  await syncCalendar(id);
  refresh(id);
  return {};
}

export async function setLineField(lineId: string, field: "label" | "qty" | "unitPrice" | "unitCost" | "perPerson", raw: string): Saved {
  await requireUser("MANAGER");
  const line = await db.privateEventLine.findUnique({ where: { id: lineId }, select: { privateEventId: true, kind: true } });
  if (!line) return { error: "That line is gone" };
  const value = raw.trim();
  let data: Prisma.PrivateEventLineUpdateInput;
  switch (field) {
    case "label":
      if (!value) return { error: "Can't be empty" };
      data = { label: value.slice(0, 120) };
      break;
    case "qty": {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: "A number" };
      data = { qty: D(Math.round(n * 100) / 100) };
      break;
    }
    case "unitPrice":
    case "unitCost": {
      const n = parseMoney(value);
      if (n === undefined) return { error: "An amount" };
      if (field === "unitCost" && line.kind !== "CUSTOM") return { error: "Cost comes from the recipe" };
      data = field === "unitPrice" ? { unitPrice: D(n ?? 0) } : { unitCost: n == null ? null : D(n) };
      break;
    }
    case "perPerson":
      data = { perPerson: value === "1" || value === "true" };
      break;
    default:
      return { error: "Unknown field" };
  }
  await db.privateEventLine.update({ where: { id: lineId }, data });
  await syncCalendar(line.privateEventId);
  refresh(line.privateEventId);
}

export async function removeQuoteLine(lineId: string): R {
  await requireUser("MANAGER");
  const line = await db.privateEventLine.delete({ where: { id: lineId } }).catch(() => null);
  if (line) {
    await syncCalendar(line.privateEventId);
    refresh(line.privateEventId);
  }
  return {};
}

// ---- Sharing the quote ----------------------------------------------------------------

const quotePath = (token: string) => `/quote/${token}`;

/** The client's link (made if needed). Copying it counts as sending the quote. */
export async function shareLink(id: string, opts?: { fresh?: boolean; markSent?: boolean }): Promise<{ error?: string; url?: string; message?: string }> {
  await requireUser("MANAGER");
  const token = await ensureQuoteToken(id, opts?.fresh);
  if (opts?.markSent !== false) await markQuoteSent(id);
  refresh(id);
  return { url: link(await publicOrigin(), quotePath(token)), message: opts?.fresh ? "New link made — the old one no longer works." : undefined };
}

export async function emailQuote(id: string): R {
  await requireUser("MANAGER");
  const ev = await getPrivateEvent(id);
  if (!ev) return { error: "That booking is gone." };
  const to = ev.row.clientEmail;
  if (!isEmail(to)) return { error: "Add the client's email first." };
  if (!(await emailReady())) return { error: "Email isn't set up yet — copy the link instead." };
  const token = await ensureQuoteToken(id);
  const url = link(await publicOrigin(), quotePath(token));
  const biz = await getBusinessContact();
  const first = ev.row.clientName.split(/\s+/)[0];
  const when = ev.row.date ? new Date(`${ev.row.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "your date";
  const subject = `Your quote from ${biz.name} for ${when}`;
  const html = shell({
    preheader: `${ev.row.headcount} guests · $${ev.quote.total.toFixed(2)}`,
    body: [
      h1(`Your quote for ${when}`),
      p(`Hi ${esc(first)}, thanks for thinking of us. Here's the quote for ${ev.row.headcount} guests${ev.row.space ? ` in the ${esc(ev.row.space.toLowerCase())}` : ""}.`),
      p(`Total <strong>$${ev.quote.total.toFixed(2)}</strong>${ev.quote.deposit > 0 ? ` · deposit $${ev.quote.deposit.toFixed(2)} to hold the date` : ""}.`),
      button(url, "See and accept the quote"),
      small(`Questions? Just reply to this email${biz.phone ? ` or call ${esc(biz.phone)}` : ""}.`),
    ].join(""),
    footer: `${esc(biz.name)} · Catskill, NY`,
  });
  const text = textLines(`Hi ${first},`, "", `Here's your quote for ${when}: ${ev.row.headcount} guests, total $${ev.quote.total.toFixed(2)}.`, `See and accept it here: ${url}`, "", biz.name);
  const r = await sendEmail({ to, subject, html, text, replyTo: isEmail(biz.email) ? biz.email : undefined, tags: { kind: "private_event_quote" } });
  if ("error" in r) return { error: r.error };
  if ("skipped" in r) return { error: r.skipped };
  await markQuoteSent(id);
  refresh(id);
  return { message: `Quote emailed to ${to}.` };
}

// ---- Payments -------------------------------------------------------------------------

const paymentSchema = z.object({ amount: z.string().max(20), kind: z.enum(["DEPOSIT", "BALANCE", "OTHER"]), method: z.enum(["CARD", "CASH", "CHECK", "SQUARE_LINK", "OTHER"]), paidOn: isoDate, note: z.string().max(200).optional().default("") });

export async function addPayment(id: string, input: z.input<typeof paymentSchema>): R {
  const me = await requireUser("MANAGER");
  const v = paymentSchema.safeParse(input);
  if (!v.success) return { error: "Check the amount and date." };
  const amount = parseMoney(v.data.amount);
  if (amount == null || amount <= 0) return { error: "Enter the amount paid." };
  if (v.data.paidOn > businessToday()) return { error: "That date hasn't happened yet." };
  const r = await recordPayment(id, { amount, kind: v.data.kind, method: v.data.method, paidOn: v.data.paidOn, note: v.data.note, userId: me.userId });
  refresh(id);
  return r;
}

export async function removePayment(paymentId: string): R {
  await requireUser("MANAGER");
  const id = await deletePayment(paymentId);
  if (id) {
    await syncCalendar(id);
    refresh(id);
  }
  return {};
}

/** A Square-hosted payment link for the deposit or balance. */
export async function squarePaymentLink(id: string, which: "deposit" | "balance"): Promise<{ error?: string; url?: string }> {
  await requireUser("MANAGER");
  const ev = await getPrivateEvent(id);
  if (!ev) return { error: "That booking is gone." };
  const amount = which === "deposit" ? Math.max(0, ev.quote.deposit - ev.quote.paid) : ev.quote.balance;
  if (amount <= 0) return { error: `Nothing left to pay on the ${which}.` };
  try {
    const client = await requireSquareClient();
    const when = ev.row.date ? ` ${ev.row.date}` : "";
    const l = await createQuickPayLink(client, { name: `${which === "deposit" ? "Deposit" : "Balance"} — ${ev.row.title}${when}`, amountCents: Math.round(amount * 100), note: `Private event ${ev.row.id}` });
    await db.privateEvent.update({ where: { id }, data: { paymentLinkUrl: l.url, paymentLinkId: l.id, paymentLinkAmount: D(amount) } });
    refresh(id);
    return { url: l.url };
  } catch (e) {
    if (e instanceof SquareNotConnectedError) return { error: e.message };
    const msg = friendlySquareError(e);
    return { error: /permission/i.test(msg) ? "Square needs permission to take payments. Reconnect Square and allow payments, or record the payment by hand." : msg };
  }
}

/** Email the client a deposit or balance reminder, or hand back the text to send another way. */
export async function sendReminder(id: string, which: "deposit" | "balance"): Promise<{ error?: string; message?: string; text?: string }> {
  await requireUser("MANAGER");
  const ev = await getPrivateEvent(id);
  if (!ev) return { error: "That booking is gone." };
  const amount = which === "deposit" ? Math.max(0, ev.quote.deposit - ev.quote.paid) : ev.quote.balance;
  if (amount <= 0) return { error: `Nothing owed on the ${which}.` };
  const biz = await getBusinessContact();
  const url = ev.share.paymentLinkUrl ?? (ev.share.token ? link(await publicOrigin(), quotePath(ev.share.token)) : null);
  const eventLabel = ev.row.date ? `your event on ${new Date(`${ev.row.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}` : "your event";
  const text = reminderText({ clientName: ev.row.clientName, eventLabel, amount, dueOn: which === "deposit" ? ev.row.depositDueOn : ev.row.balanceDueOn, kind: which, link: url, business: biz.name });
  const to = ev.row.clientEmail;
  if (!isEmail(to) || !(await emailReady())) return { text, message: isEmail(to) ? "Email isn't set up — copy this and text or email it." : "No email on file — copy this and text it." };
  const r = await sendEmail({
    to,
    subject: `Reminder: ${which} for ${eventLabel}`,
    html: shell({ preheader: `$${amount.toFixed(2)} ${which}`, body: text.split("\n\n").map((para) => p(esc(para).replace(/\n/g, "<br>"))).join("") + (url ? button(url, ev.share.paymentLinkUrl ? "Pay now" : "See the quote") : "") }),
    text,
    replyTo: isEmail(biz.email) ? biz.email : undefined,
    tags: { kind: "private_event_reminder" },
  });
  if ("error" in r) return { error: r.error, text };
  if ("skipped" in r) return { text, message: r.skipped };
  await db.privateEvent.update({ where: { id }, data: { remindedAt: new Date() } });
  refresh(id);
  return { message: `Reminder emailed to ${to}.` };
}

// ---- Packages -------------------------------------------------------------------------

export async function addPackage(name: string, price: string): R {
  await requireUser("MANAGER");
  const n = name.trim();
  const amt = parseMoney(price);
  if (!n) return { error: "Name the package." };
  if (amt == null) return { error: "Price per person, like 35." };
  const sort = ((await db.privateEventPackage.aggregate({ _max: { sort: true } }))._max.sort ?? 0) + 1;
  await db.privateEventPackage.create({ data: { name: n.slice(0, 80), pricePerPerson: D(amt), sort } });
  revalidatePath("/events/private/setup");
  return { message: `Added ${n}.` };
}

export async function setPackageField(packageId: string, field: "name" | "description" | "pricePerPerson" | "active", raw: string): Saved {
  await requireUser("MANAGER");
  const v = raw.trim();
  let data: Prisma.PrivateEventPackageUpdateInput;
  if (field === "name") {
    if (!v) return { error: "Can't be empty" };
    data = { name: v.slice(0, 80) };
  } else if (field === "description") data = { description: v ? v.slice(0, 300) : null };
  else if (field === "pricePerPerson") {
    const n = parseMoney(v);
    if (n == null) return { error: "An amount" };
    data = { pricePerPerson: D(n) };
  } else if (field === "active") data = { active: v === "1" || v === "true" };
  else return { error: "Unknown field" };
  await db.privateEventPackage.update({ where: { id: packageId }, data });
  revalidatePath("/events/private/setup");
}

export async function addPackageItem(packageId: string, recipeId: string): R {
  await requireUser("MANAGER");
  const r = await db.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  if (!r) return { error: "Pick a recipe." };
  const sort = ((await db.privateEventPackageItem.aggregate({ where: { packageId }, _max: { sort: true } }))._max.sort ?? 0) + 1;
  await db.privateEventPackageItem.create({ data: { packageId, recipeId, perGuest: D(1), sort } });
  revalidatePath("/events/private/setup");
  return {};
}

export async function setPackageItemPerGuest(itemId: string, raw: string): Saved {
  await requireUser("MANAGER");
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 20) return { error: "Portions per guest, like 1 or 0.5" };
  await db.privateEventPackageItem.update({ where: { id: itemId }, data: { perGuest: D(Math.round(n * 100) / 100) } });
  revalidatePath("/events/private/setup");
}

export async function removePackageItem(itemId: string): R {
  await requireUser("MANAGER");
  await db.privateEventPackageItem.delete({ where: { id: itemId } }).catch(() => null);
  revalidatePath("/events/private/setup");
  return {};
}

export async function removePackage(packageId: string): R {
  await requireUser("MANAGER");
  const used = await db.privateEventLine.count({ where: { packageId } });
  if (used > 0) {
    await db.privateEventPackage.update({ where: { id: packageId }, data: { active: false } });
    revalidatePath("/events/private/setup");
    return { message: "It's on existing quotes, so it's been hidden instead." };
  }
  await db.privateEventPackage.delete({ where: { id: packageId } });
  revalidatePath("/events/private/setup");
  return {};
}

// ---- Defaults -------------------------------------------------------------------------

export async function setConfigField(field: "taxPct" | "serviceChargePct" | "depositPct" | "barCostPct" | "depositDueDays" | "balanceDueDays", raw: string): Saved {
  await requireUser("MANAGER");
  const cfg = await getPrivateEventConfig();
  let next: PrivateEventConfig;
  if (field === "depositDueDays" || field === "balanceDueDays") {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 0 || n > 60) return { error: "Days, 0–60" };
    next = { ...cfg, [field]: n };
  } else {
    const n = parsePct(raw, field === "taxPct" ? 20 : 100);
    if (n == null) return { error: "A percent" };
    next = { ...cfg, [field]: n };
  }
  await savePrivateEventConfig(parseConfig(next));
  revalidatePath("/events/private/setup");
}

export async function setSpace(index: number, patch: { name?: string; buyout?: boolean; capacity?: string }): Saved {
  await requireUser("MANAGER");
  const cfg = await getPrivateEventConfig();
  const spaces = [...cfg.spaces];
  if (index === spaces.length) {
    const n = patch.name?.trim();
    if (!n) return { error: "Name the space" };
    if (spaces.some((s) => s.name.toLowerCase() === n.toLowerCase())) return { error: "Already on the list" };
    spaces.push({ name: n, buyout: false, capacity: null });
  } else {
    const cur = spaces[index];
    if (!cur) return { error: "That space is gone" };
    const s = { ...cur };
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) return { error: "Can't be empty" };
      if (spaces.some((x, i) => i !== index && x.name.toLowerCase() === n.toLowerCase())) return { error: "Already on the list" };
      // Keep bookings pointing at the renamed space.
      if (n !== cur.name) await db.privateEvent.updateMany({ where: { space: cur.name }, data: { space: n } });
      s.name = n;
    }
    if (patch.buyout !== undefined) s.buyout = patch.buyout;
    if (patch.capacity !== undefined) {
      const c = patch.capacity.trim() === "" ? null : Number(patch.capacity);
      if (c !== null && (!Number.isInteger(c) || c <= 0 || c > 5000)) return { error: "Guests, or blank" };
      s.capacity = c;
    }
    spaces[index] = s;
  }
  await savePrivateEventConfig({ ...cfg, spaces });
  revalidatePath("/events/private/setup");
}

export async function removeSpace(index: number): R {
  await requireUser("MANAGER");
  const cfg = await getPrivateEventConfig();
  if (cfg.spaces.length <= 1) return { error: "Keep at least one space." };
  await savePrivateEventConfig({ ...cfg, spaces: cfg.spaces.filter((_, i) => i !== index) });
  revalidatePath("/events/private/setup");
  return {};
}

