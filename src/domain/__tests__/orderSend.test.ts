import { describe, expect, it } from "vitest";
import { callScript, devicePlatform, digitsOnly, portalCsv, portalText, smsHref, sortByGuide, telHref, textOrderMessage, type SendLine } from "../orderSend";

const lines: SendLine[] = [
  { qty: 2, unit: "case", name: "Butter unsalted 36/1 lb", sku: "20010" },
  { qty: 1, unit: "each", name: "Sourdough loaf", sku: "CBC-SD" },
  { qty: 1.5, unit: "dozen", name: "Potato bun", sku: "CBC-BUN" },
];

describe("textOrderMessage", () => {
  it("is short and plain: greeting, delivery day, one line per item, sign-off", () => {
    expect(textOrderMessage({ supplierName: "Catskill Bread Co.", deliveryDate: "2026-11-18", lines, from: "Max at Subversive" })).toBe(
      ["Hi Catskill Bread Co., order for Wed Nov 18:", "2 case Butter unsalted 36/1 lb", "1 each Sourdough loaf", "1.5 dozen Potato bun", "Thanks! Max at Subversive"].join("\n"),
    );
  });
  it("says so when there's nothing on it", () => {
    expect(textOrderMessage({ supplierName: "X", deliveryDate: "2026-11-18", lines: [], from: "Max" })).toContain("(no items)");
  });
});

describe("sms and tel links", () => {
  it("prefills the message the way each phone expects", () => {
    expect(smsHref("(518) 555-0142", "Hi & thanks", "ios")).toBe("sms:5185550142&body=Hi%20%26%20thanks");
    expect(smsHref("+1 518 555 0142", "Hi", "android")).toBe("sms:+15185550142?body=Hi");
    expect(smsHref("518.555.0142", "Hi", "desktop")).toBe("sms:5185550142?body=Hi");
  });
  it("dials with digits only", () => {
    expect(telHref("(518) 555-0142 ext 2")).toBe("tel:51855501422");
    expect(digitsOnly("+1 (518) 555-0142")).toBe("+15185550142");
  });
  it("tells phones from computers", () => {
    expect(devicePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(devicePlatform("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)")).toBe("ios");
    expect(devicePlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(devicePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(devicePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios"); // iPadOS reports as a Mac with touch
  });
});

describe("portal orders", () => {
  it("sorts lines in the supplier's own order where known, the rest after by name", () => {
    const guide = new Map([["CBC-BUN", 0], ["20010", 1]]);
    expect(sortByGuide(lines, guide).map((l) => l.sku)).toEqual(["CBC-BUN", "20010", "CBC-SD"]);
    expect(sortByGuide(lines, new Map()).map((l) => l.sku)).toEqual(["20010", "CBC-BUN", "CBC-SD"]);
  });
  it("copies item numbers first", () => {
    expect(portalText(lines.slice(0, 1))).toBe("#20010  2 case  Butter unsalted 36/1 lb");
  });
  it("makes a CSV with item numbers and quantities", () => {
    expect(portalCsv(lines.slice(0, 2))).toBe('"Item #","Qty","Unit","Description"\r\n"20010","2","case","Butter unsalted 36/1 lb"\r\n"CBC-SD","1","each","Sourdough loaf"');
  });
});

describe("callScript", () => {
  it("reads the order out line by line", () => {
    const s = callScript({ supplierName: "Kilcoyne", deliveryDate: "2026-11-20", lines: lines.slice(0, 2), from: "Subversive" });
    expect(s[0]).toBe("Hi, this is Subversive placing an order for Fri Nov 20.");
    expect(s).toContain("2 case — Butter unsalted 36/1 lb (#20010)");
    expect(s.at(-1)).toBe("Could you read that back to me? Thanks!");
  });
});
