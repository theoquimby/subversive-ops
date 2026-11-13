import type { HelpEntry } from "../types";

// Prepped waste, allergens, ingredient drill-down, feedback, documents, the
// policy assistant, Ask, forecast nudges on the schedule and the wage table.

export const finalParity: HelpEntry[] = [
  // ---- Waste ----------------------------------------------------------------
  {
    id: "waste.prepItems",
    area: "waste",
    route: "/waste",
    audience: "all",
    title: "Prepped and plated items",
    body: "Threw out a batch of aioli or dropped three burgers? Pick “Prep or menu item”. It's logged as the ingredients the recipe uses, so food cost and the margin gap count it.",
    article: `Switch the form to **Prep or menu item**, pick the item, and enter how much:

- **Prep recipes** (sauces, doughs) take the batch unit — e.g. **2 qt** of aioli, or ml, l, cups.
- **Menu items** are counted in plates — **3** burgers.

The app works out what went into it from the recipe (sub-recipes included, with trim loss) and logs one waste line per ingredient. The entry shows as one line in **Last two weeks**, with the ingredients underneath; removing it removes them all.

Undo works the same as ingredient waste: whoever logged it can remove it for 15 minutes; managers any time.`,
    related: ["waste.form", "waste.recent", "variance.waste"],
    keywords: ["prep", "batch", "plate", "dropped", "sauce", "menu item", "recipe waste"],
  },

  // ---- Ingredients ----------------------------------------------------------
  {
    id: "ingredients.allergens",
    area: "ingredients",
    route: "/ingredients",
    title: "Allergens",
    body: "Tap each major allergen this ingredient contains. Recipes pick them up automatically, through sub-recipes too, and they appear on the allergen chart.",
    article: `The nine major US allergens: milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy and sesame. Check the supplier's label — "may contain" warnings and kitchen cross-contact aren't tracked, so treat the chart as a starting point, not a guarantee.

Changes save as you tap. Every recipe using the ingredient (directly or inside a prep recipe) shows it on its page and on the [allergen chart](/menu/allergens).`,
    related: ["menu.allergens", "menu.allergenChart"],
    keywords: ["allergy", "gluten", "nuts", "dairy", "sesame", "shellfish"],
  },
  {
    id: "ingredients.drilldown",
    area: "ingredients",
    route: "/ingredients",
    title: "Recent invoices and orders",
    body: "The last invoice lines and order lines for this ingredient's products: price paid, quantity, and any price or quantity issues. Tap one to open the invoice or order.",
    related: ["ingredients.history", "invoices.match", "ordering.po"],
    keywords: ["invoice", "purchase order", "drill down", "what did we pay"],
  },

  // ---- Menu -----------------------------------------------------------------
  {
    id: "menu.allergens",
    area: "menu",
    route: "/menu",
    title: "Recipe allergens",
    body: "Allergens in this recipe, rolled up from its ingredients and sub-recipes, with the ingredients that bring each one in. Tag allergens on each ingredient's page.",
    related: ["ingredients.allergens", "menu.allergenChart"],
    keywords: ["allergy", "contains"],
  },
  {
    id: "menu.allergenChart",
    area: "menu",
    route: "/menu/allergens",
    title: "Allergen chart",
    body: "Every menu item against the nine major allergens, ready to print for the line or the host stand. On a phone it lists each item with what it contains.",
    article: `Open it from **Menu costs → Allergens**. **Print** gives a clean sheet without the app's menus. **Include add-ons** adds modifiers like "add bacon".

The chart only knows what's tagged on ingredients. An item with nothing tagged shows no dots — that means "not tagged", not "allergen-free". Shared fryers and cutting boards aren't captured; confirm with the kitchen before promising a guest anything.`,
    related: ["ingredients.allergens", "menu.allergens"],
    keywords: ["allergen matrix", "print", "allergy chart"],
  },

  // ---- Team -----------------------------------------------------------------
  {
    id: "team.feedback",
    area: "team",
    route: "/team",
    title: "Notes and kudos",
    body: "Tap a name to leave kudos, a coaching note or a private manager note. Kudos and coaching can be shared — they then show on that person's My shifts.",
    article: `Each person's sheet has:

- **Kudos** — something they did well. Shared by default.
- **Coaching** — what to work on. Shared by default; switch it off to keep it between managers.
- **Note** — private to managers.

The eye icon on any note shares or hides it later. People without a login can't see notes, so sharing is off for them.

The sheet also lists the documents they still need to sign.`,
    related: ["team.documents", "my.feedback"],
    keywords: ["feedback", "praise", "write up", "coaching", "performance"],
  },
  {
    id: "team.documents",
    area: "team",
    route: "/team/documents",
    title: "Documents",
    body: "Upload the handbook, policies and new-hire forms (PDF, Word, text or a photo, up to 8 MB). Mark any that staff must acknowledge; they sign on My shifts.",
    article: `### Uploading
Drop a file on **Team → Documents**, give it a title and type, and choose:

- **Who sees it** — everyone, or managers only.
- **Staff must acknowledge** — shows on My shifts with an "I've read this" button until they tap it.

For tax forms (W-4, IT-2104), upload the blank form here so new hires can download it; collect the filled-in copy the way you do today.

### Text for questions
The policy assistant answers from each document's text. It's read from most PDFs automatically (with the Claude key, scans too). For Word files or scans, open **•••** and paste the text.

### Sign-off
The **Sign-off** table shows who has acknowledged each required document and when.`,
    related: ["team.policyAssistant", "team.feedback", "my.documents"],
    keywords: ["handbook", "onboarding", "w-4", "it-2104", "policy", "upload", "acknowledge", "sign"],
  },
  {
    id: "team.documents.upload",
    area: "team",
    route: "/team/documents",
    title: "Add a document",
    body: "Drop a PDF, Word file, text file or photo up to 8 MB. Title and type can be changed later in the library.",
    related: ["team.documents"],
  },
  {
    id: "team.documents.signoff",
    area: "team",
    route: "/team/documents",
    title: "Sign-off",
    body: "Who has acknowledged each required document, with the date. People need a login to sign.",
    related: ["team.documents", "team.invite"],
  },
  {
    id: "team.policyAssistant",
    area: "team",
    route: "/help",
    audience: "all",
    title: "Ask about policies",
    body: "Type a question like “how long is my meal break?”. Answers come only from the handbook and policies managers uploaded, with the document named. If they don't cover it, it says so.",
    article: `The assistant never makes policy up.

- **With the Claude key**, it writes a short answer from the uploaded documents and shows the exact lines it used, with the document's title. If the documents don't answer the question, it says so.
- **Without it**, it shows the passages that match your words best.

Staff see staff documents only; managers also search manager-only ones. Ask a manager when something looks wrong — the documents may be out of date.`,
    related: ["team.documents"],
    keywords: ["hr", "policy", "handbook", "question", "assistant"],
  },

  // ---- My shifts ------------------------------------------------------------
  {
    id: "my.documents",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Documents to read",
    body: "Your handbook and policies. Tap one to read it. If it says “I've read this”, tap that once you have — your manager sees it's done.",
    related: ["my.policyAsk"],
    keywords: ["handbook", "sign", "acknowledge"],
  },
  {
    id: "my.feedback",
    area: "my",
    route: "/my",
    audience: "all",
    title: "From your managers",
    body: "Kudos and coaching notes your managers chose to share with you.",
    related: ["my.page"],
    keywords: ["feedback", "kudos"],
  },
  {
    id: "my.policyAsk",
    area: "my",
    route: "/my",
    audience: "all",
    title: "Ask about policies",
    body: "Ask a question about breaks, call-outs, dress code and so on. The answer comes from the handbook and policies your managers uploaded, and names the document.",
    related: ["my.documents"],
    keywords: ["hr", "policy", "question"],
  },

  // ---- Schedule -------------------------------------------------------------
  {
    id: "schedule.nudge",
    area: "schedule",
    route: "/schedule",
    title: "Adjust the forecast",
    body: "Know a day will be busier or quieter? Under Staff vs demand, tap Adjust, enter +15 or −20 and why. Staffing and labor % update; Regenerate draft rebuilds the draft shifts.",
    related: ["schedule.demand", "schedule.generate", "sales.adjust"],
    keywords: ["forecast", "busier", "slower", "festival", "override"],
  },

  // ---- Settings -------------------------------------------------------------
  {
    id: "settings.wageSchedule",
    area: "settings",
    route: "/settings/pay",
    title: "NY minimum wage schedule",
    body: "When on, the minimum and tipped wages follow the upstate NY rate table and switch on January 1. Future rates are marked estimated. You must verify every rate against NY DOL.",
    article: `Upstate New York (outside NYC, Long Island and Westchester): $15.50 in 2025 and $16.00 in 2026 (tipped food service cash wage $10.35 and $10.70). From 2027 the rate is indexed to inflation and published by NY DOL each autumn — the table's 2027 figure is an **estimate** until it's replaced with the published rate.

Typing a minimum wage in the rules below switches the table off, so your own figure is used.

**Rules last reviewed** records who last checked the whole rule set and when. It asks again after a rate change and once a year. This is a convenience, not legal advice.`,
    related: ["labor.overtime", "labor.spread"],
    keywords: ["minimum wage", "tipped wage", "tip credit", "2027", "regulation", "law change"],
  },

  // ---- Ask ------------------------------------------------------------------
  {
    id: "ask.page",
    area: "overview",
    route: "/ask",
    title: "Ask",
    body: "Ask about your numbers in plain English — food cost last week, items that lost margin, who's over 35 hours. Answers use live data and link to the page behind them.",
    article: `**Suggested questions** always work: each runs a fixed report (P&L for a period, menu margins, price changes, margin gap, the week's schedule, suggested orders, waste).

**Typed questions** use Claude once AI features are on ([Settings → Connections](/settings/connections?open=ai)): it picks the reports it needs, reads the results and answers in a sentence or two. Every number comes from those reports, which are shown under the answer with links. Without the key, simple questions are matched to the closest report.

Ask only reads data; it never changes anything.`,
    related: ["overview.page", "pnl.page", "variance.page"],
    keywords: ["ask nory", "chat", "question", "assistant", "ai"],
  },
  {
    id: "ask.suggestions",
    area: "overview",
    route: "/ask",
    title: "Suggested questions",
    body: "Tap one to run a fixed report on your live numbers: P&L, menu margins, price changes, margin gap, the schedule, suggested orders or waste. These always work, with or without the Claude key.",
    related: ["ask.page"],
  },
  {
    id: "ask.input",
    area: "overview",
    route: "/ask",
    title: "Ask your own question",
    body: "Type a question in plain English and press Enter. With AI features on it picks the right reports and answers; without them, simple questions are matched to the closest report.",
    related: ["ask.page"],
  },
  {
    id: "ask.answer",
    area: "overview",
    route: "/ask",
    title: "The answer",
    body: "Your question and the answer, with the figures it used and links to the pages behind them. Ask only reads data; it never changes anything.",
    related: ["ask.page"],
  },
  {
    id: "menu.allergenChart.actions",
    area: "menu",
    route: "/menu/allergens",
    title: "Add-ons and printing",
    body: "Include add-ons adds modifiers like extra cheese to the chart. Print gives a clean one-page version for the line or the host stand.",
    related: ["menu.allergenChart"],
  },
  {
    id: "menu.draftBeer.form",
    area: "menu",
    route: "/menu/draft-beer",
    title: "Set up a beer",
    body: "The beer's name, keg size, what a keg costs and how much is usable after foam and line loss, then each pour with its size and menu price. Link each pour to its Square item so sales count.",
    related: ["menu.draftBeer"],
  },
  {
    id: "menu.draftBeer.kegs",
    area: "menu",
    route: "/menu/draft-beer",
    title: "Kegs on file",
    body: "Each keg with its size, cost and cost per ounce after loss. To record a price change, enter the beer again with the new keg cost — past days keep the cost that applied then.",
  },
  {
    id: "menu.draftBeer.pours",
    area: "menu",
    route: "/menu/draft-beer",
    title: "Beer on the menu",
    body: "Each pour's cost against its menu price and its cost %, red when it's over target. Tap one to open its recipe.",
    related: ["menu.list"],
  },
  {
    id: "team.documents.library",
    area: "team",
    route: "/team/documents",
    title: "Library",
    body: "Every document with its title, type, who can see it and whether staff must sign it. Edit any cell in place; ••• shows the text the policy assistant reads.",
    related: ["team.policyAssistant"],
  },
];
