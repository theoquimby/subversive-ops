/**
 * The P&L's chart colours as Tailwind variable classes: one colour per job on every P&L chart
 * (see story-charts.tsx for the palette and how it was checked). A plain module, not a client one,
 * so server pages can put the class on their own markup.
 */
export const VIZ_VARS = "[--viz-cogs:var(--money-goods)] [--viz-labor:var(--money-wages)] [--viz-profit:var(--money-kept)] [--viz-fees:var(--money-fees)] [--viz-sales:var(--money-sales)]";
