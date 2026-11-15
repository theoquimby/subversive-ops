import type { HelpEntry } from "../types";

/** Card fees and comps & discounts from Square, on the P&L and in Settings → Money. */
export const fees: HelpEntry[] = [
  {
    id: "pnl.fees",
    area: "pnl",
    route: "/pnl",
    title: "Card fees",
    body: "Square's processing fees on the card payments taken each day, less fees Square gave back on refunds. They come off profit after labor. Square adds a fee a little after the payment, so the nightly sync fills in the last few days.",
    related: ["pnl.headline", "pnl.caveats", "sales.sync"],
    keywords: ["processing fee", "credit card fee", "square fee", "merchant fee", "interchange", "refund"],
  },
  {
    id: "pnl.comps",
    area: "pnl",
    route: "/pnl",
    title: "Comps & discounts",
    body: "What was taken off at the register, from the discount names rung in Square: by reason, item, or who took the payment. It's already out of net sales. Comped food is in food cost because it was made, so it isn't logged as waste too.",
    related: ["settings.money.discounts", "pnl.headline", "waste.page"],
    keywords: ["comp", "comps", "spill", "staff meal", "manager comp", "discount", "void", "promo", "happy hour", "remake"],
  },
  {
    id: "settings.money.discounts",
    area: "settings",
    route: "/settings/money",
    title: "What discounts count as",
    body: "Each discount name rung in Square counts as a comp, waste, staff meal or promo on the P&L. By default the name decides (spill or remake is waste, staff is a staff meal, comp or manager is a comp), and a 100% discount is a comp. Change any one here.",
    related: ["pnl.comps"],
    keywords: ["comp", "spill", "staff meal", "discount names", "mapping", "promo"],
  },
];
