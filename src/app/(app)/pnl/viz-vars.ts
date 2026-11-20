/**
 * The P&L's chart colours as Tailwind variable classes: one colour per job on every P&L chart
 * (see story-charts.tsx for the palette and how it was checked). A plain module, not a client one,
 * so server pages can put the class on their own markup.
 */
export const VIZ_VARS = "[--viz-cogs:#6250d6] [--viz-labor:var(--series-2)] [--viz-profit:#2563eb] [--viz-fees:#0f8577] dark:[--viz-cogs:#9085e9] dark:[--viz-profit:#3d76ea] dark:[--viz-fees:#2fae9e]";
