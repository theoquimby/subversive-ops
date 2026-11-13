/**
 * Every setting in one list: the Settings home, its search and the desktop
 * section nav all read this. Pure data, safe on server and client.
 *
 * `href` is where the setting is changed (a Settings sub-page anchor, or the
 * page that owns it). Values shown at a glance are computed by the home page
 * (summary.ts) and keyed by item id.
 */

export type SectionId = "business" | "people" | "food" | "money" | "insights" | "connections" | "notifications" | "data";

export interface SettingsSection {
  id: SectionId;
  title: string;
  /** One line under the title on the home page. */
  blurb: string;
  /** Sub-pages in this section, for the desktop nav. */
  pages: { href: string; label: string }[];
}

export interface SettingsItem {
  id: string;
  section: SectionId;
  label: string;
  /** What changes when you change it — one plain line. */
  what: string;
  href: string;
  help?: string;
  keywords?: string;
  /** Opens another part of the app rather than a Settings page. */
  elsewhere?: boolean;
}

export const SECTIONS: SettingsSection[] = [
  { id: "business", title: "Business", blurb: "Who you are, when you're open and where — used by the forecast, the schedule and emails.", pages: [{ href: "/settings/business", label: "Business profile" }] },
  { id: "people", title: "People & pay", blurb: "Logins, what staff can open, wages, overtime, breaks and the pay period.", pages: [{ href: "/settings/people", label: "Logins & access" }, { href: "/settings/pay", label: "Pay & labor rules" }] },
  { id: "food", title: "Food & ordering", blurb: "Cost targets, price alerts, suppliers, order cutoffs and storage areas.", pages: [{ href: "/settings/food", label: "Food & drink" }, { href: "/settings/suppliers", label: "Suppliers" }, { href: "/settings/areas", label: "Storage areas" }] },
  { id: "money", title: "Money & accounting", blurb: "Sales tax, invoice checks, payment terms, fixed costs and budgets.", pages: [{ href: "/settings/money", label: "Money & accounting" }] },
  { id: "insights", title: "Insights & reviews", blurb: "How much history Insights learns from, and how review replies sound.", pages: [{ href: "/settings/insights", label: "Insights & reviews" }] },
  { id: "connections", title: "Connections", blurb: "Square, QuickBooks, email, phone alerts, AI and Google reviews.", pages: [{ href: "/settings/connections", label: "Connections" }, { href: "/settings/square", label: "Square" }, { href: "/settings/quickbooks", label: "QuickBooks" }] },
  { id: "notifications", title: "Notifications", blurb: "Which alerts you get, by email and on your phone.", pages: [{ href: "/settings/notifications", label: "Notifications" }] },
  { id: "data", title: "Data & help", blurb: "Import, export, demo data, starting over, and where to get help.", pages: [{ href: "/settings/data", label: "Data" }, { href: "/settings/about", label: "Help & about" }] },
];

export const ITEMS: SettingsItem[] = [
  // Business
  { id: "business.profile", section: "business", label: "Name & contact", what: "Shown on orders you email to suppliers.", href: "/settings/business#profile", help: "settings.business.profile", keywords: "address phone website email name delivery" },
  { id: "business.hours", section: "business", label: "Opening hours", what: "Shapes the hourly forecast, staffing and which days count as closed.", href: "/settings/business#hours", help: "settings.business.hours", keywords: "open close closed tuesday days weekday service" },
  { id: "business.seasons", section: "business", label: "Seasonal hours", what: "Different hours for part of the year, like summer.", href: "/settings/business#seasons", help: "settings.business.seasons", keywords: "summer winter season holiday hours" },
  { id: "business.weather", section: "business", label: "Weather location", what: "Where the forecast reads the weather from.", href: "/settings/business#weather", help: "settings.business.weather", keywords: "town city latitude longitude rain" },
  { id: "business.timezone", section: "business", label: "Time zone", what: "What \"today\" means for sales, counts and timecards.", href: "/settings/business#timezone", help: "settings.business.timezone", keywords: "timezone clock eastern" },

  // People & pay
  { id: "people.logins", section: "people", label: "Logins & PINs", what: "Who can sign in, as staff or manager.", href: "/settings/people#logins", help: "settings.team", keywords: "users pin password reset lock manager staff add person" },
  { id: "people.access", section: "people", label: "What staff can open", what: "The pages staff see on their phones.", href: "/settings/people#access", help: "settings.people.access", keywords: "permissions roles staff access" },
  { id: "people.positions", section: "people", label: "Positions & pay rates", what: "Each position's rate, tips and staffing — on the Team page.", href: "/team", elsewhere: true, help: "settings.people.positions", keywords: "position rate wage server cook bartender" },
  { id: "pay.wage", section: "people", label: "Minimum wage", what: "Follows the NY schedule by itself, or your own rates.", href: "/settings/pay#wage", help: "settings.wageSchedule", keywords: "minimum wage tipped rate ny" },
  { id: "pay.overtime", section: "people", label: "Overtime", what: "Hours in a week before overtime, and the rate.", href: "/settings/pay#rules", help: "settings.laborRules", keywords: "overtime 40 hours 1.5 time and a half" },
  { id: "pay.breaks", section: "people", label: "Breaks & shift limits", what: "Meal breaks, rest between shifts, longest shift, minors.", href: "/settings/pay#rules", help: "settings.laborRules", keywords: "meal break rest clopen minors long shift" },
  { id: "pay.period", section: "people", label: "Pay period", what: "Weekly or every two weeks — sets timecard approval and payroll.", href: "/settings/pay#rules", help: "settings.laborRules", keywords: "payroll biweekly weekly period" },
  { id: "pay.sick", section: "people", label: "Paid sick leave", what: "How fast sick hours build up and the yearly cap.", href: "/settings/pay#rules", help: "labor.sick", keywords: "sick leave accrual pto" },
  { id: "pay.checks", section: "people", label: "Schedule checks", what: "Which compliance checks block publishing, warn, or are off.", href: "/settings/pay#rules", help: "schedule.compliance", keywords: "compliance must fix warn off rules" },
  { id: "pay.laborTarget", section: "people", label: "Labor target", what: "Labor % the schedule aims for when a week has no budget.", href: "/settings/pay#target", help: "settings.pay.laborTarget", keywords: "labor percent budget target" },
  { id: "pay.autoDraft", section: "people", label: "Draft next week's schedule", what: "Fri/Sat, the app drafts next week from the forecast.", href: "/settings/pay#target", help: "settings.pay.autoDraft", keywords: "auto draft schedule weekend" },
  { id: "pay.tips", section: "people", label: "Tip pools", what: "Split by hours or points — set per position and per period.", href: "/tips", elsewhere: true, help: "settings.pay.tips", keywords: "tips pool points share" },

  // Food & ordering
  { id: "food.target", section: "food", label: "Food cost target", what: "The goal for every menu item; items can set their own.", href: "/settings/food#target", help: "settings.target", keywords: "food cost percent goal plate" },
  { id: "food.bevTarget", section: "food", label: "Drink cost target", what: "The goal for beer and other drinks on the P&L.", href: "/settings/food#target", help: "settings.food.bevTarget", keywords: "beverage beer pour cost bar" },
  { id: "food.spike", section: "food", label: "Price rise alerts", what: "How big a price rise has to be before you're told.", href: "/settings/food#alerts", help: "settings.food.spike", keywords: "price spike alert threshold increase" },
  { id: "food.classes", section: "food", label: "Menu categories", what: "Which Square categories count as food, beer, drinks or retail.", href: "/menu/draft-beer", elsewhere: true, help: "settings.food.classes", keywords: "category class food beverage retail revenue" },
  { id: "food.suppliers", section: "food", label: "Suppliers", what: "Delivery days, lead time, minimums, order emails and cutoffs.", href: "/settings/suppliers", help: "settings.suppliers", keywords: "vendor distributor delivery cutoff minimum email sysco" },
  { id: "food.areas", section: "food", label: "Storage areas", what: "Where things live, in the order you walk them when counting.", href: "/settings/areas", help: "settings.areas", keywords: "walk-in freezer bar dry storage count order" },
  { id: "food.buffer", section: "food", label: "Order buffer & pars", what: "Extra on top of the forecast, per ingredient — on Ingredients.", href: "/ingredients", elsewhere: true, help: "settings.food.buffer", keywords: "par buffer safety stock minimum on hand busy weekend" },

  // Money
  { id: "money.tax", section: "money", label: "Sales tax", what: "Used for the sales journal when Square didn't record the day's tax.", href: "/settings/money#tax", help: "settings.money.tax", keywords: "sales tax rate 8 percent" },
  { id: "money.tolerance", section: "money", label: "Invoice matching", what: "How far an invoice can be off before it's flagged.", href: "/settings/money#invoices", help: "settings.money.tolerance", keywords: "tolerance price quantity mismatch invoice" },
  { id: "money.autoApprove", section: "money", label: "Auto-approve invoices", what: "Clean matches approve themselves.", href: "/settings/money#invoices", help: "settings.money.autoApprove", keywords: "approve automatic invoice" },
  { id: "money.terms", section: "money", label: "Payment terms", what: "Due date on bills sent to QuickBooks or exported.", href: "/settings/money#invoices", help: "settings.money.terms", keywords: "net 30 due days terms bills" },
  { id: "money.fixed", section: "money", label: "Fixed monthly costs", what: "Rent, utilities, insurance — for break-even and profit on Insights.", href: "/settings/money#fixed", help: "settings.money.fixed", keywords: "rent utilities insurance overhead break even" },
  { id: "money.budgets", section: "money", label: "Weekly budgets", what: "Sales, food cost and labor targets by week.", href: "/budgets", elsewhere: true, help: "budgets.page", keywords: "budget target weekly" },
  { id: "money.accounts", section: "money", label: "Account mapping", what: "Which accounts bills and sales go to in the export.", href: "/invoices/exports", elsewhere: true, help: "settings.money.accounts", keywords: "chart of accounts p&l category xero quickbooks journal" },

  // Insights & reviews
  { id: "insights.range", section: "insights", label: "History Insights uses", what: "How many years of sales the models learn from.", href: "/settings/insights#range", help: "insights.range", keywords: "analytics years history range" },
  { id: "insights.tone", section: "insights", label: "Review reply voice", what: "Notes that shape every drafted reply to a review.", href: "/settings/insights#tone", help: "settings.insights.tone", keywords: "reviews reply tone voice google yelp" },

  // Connections
  { id: "conn.all", section: "connections", label: "Connections", what: "Square, email, phone alerts, AI, Google reviews and QuickBooks.", href: "/settings/connections", help: "settings.connections", keywords: "integrations api key resend vapid anthropic google" },
  { id: "conn.square", section: "connections", label: "Square", what: "Sales, menu and timecards — locations, sync and history import.", href: "/settings/square", help: "settings.square", keywords: "pos sync locations webhook" },
  { id: "conn.qbo", section: "connections", label: "QuickBooks", what: "Approved invoices go over as bills.", href: "/settings/quickbooks", help: "settings.quickbooks", keywords: "accounting bills qbo" },

  // Notifications
  { id: "notify.all", section: "notifications", label: "Your alerts", what: "Turn each alert on or off for email and your phone.", href: "/settings/notifications", help: "settings.notifications", keywords: "email push phone alerts brief" },

  // Data & help
  { id: "data.import", section: "data", label: "Import sheets", what: "Bring in ingredients, prices and recipes from a spreadsheet.", href: "/settings/data#import", help: "settings.data.import", keywords: "import excel csv spreadsheet" },
  { id: "data.export", section: "data", label: "Export", what: "Payroll, accounting and table downloads.", href: "/settings/data#export", help: "settings.data.export", keywords: "export download csv backup" },
  { id: "data.clear", section: "data", label: "Start over", what: "Clear all food, sales and order data. Logins stay.", href: "/settings/data#clear", help: "settings.clear", keywords: "clear reset wipe delete demo" },
  { id: "data.help", section: "data", label: "Help & about", what: "The help center, guided tours and what's running.", href: "/settings/about", help: "settings.about", keywords: "help tour support version" },
];

export const sectionOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word search over label, what it does, section, keywords and the current value.
 * Every typed word must start a word somewhere ("rent" finds Rent, not "different");
 * hits in the label rank first, then keywords.
 */
export function searchSettings(query: string, values: Record<string, string> = {}): SettingsItem[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored = ITEMS.map((it) => {
    const label = it.label.toLowerCase();
    const keys = (it.keywords ?? "").toLowerCase();
    const rest = `${it.what} ${sectionOf(it.section).title} ${values[it.id] ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      const re = new RegExp(`(^|[^a-z0-9])${esc(w)}`);
      if (re.test(label)) score += label.startsWith(w) ? 12 : 8;
      else if (re.test(keys)) score += 5;
      else if (re.test(rest)) score += 2;
      else return null;
    }
    return { it, score };
  }).filter((x): x is { it: SettingsItem; score: number } => x != null);
  return scored.sort((a, b) => b.score - a.score).map((x) => x.it);
}
