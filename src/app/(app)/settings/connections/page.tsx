import { PageHeader } from "@/components/ui";
import { SECRET_NAMES, type SecretName } from "@/domain/secretFormats";
import type { SecretStatus } from "@/domain/secrets";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { SQUARE_VERSION } from "@/server/integrations/square-http";
import { emailForUser } from "@/server/services/notify";
import { getBusinessProfile } from "@/server/services/onboarding";
import { isLocalOrigin, publicOrigin, SQUARE_REDIRECT_PATH, SQUARE_WEBHOOK_PATH } from "@/server/services/public-url";
import { pushDeviceCount } from "@/server/services/push";
import { SETTING_PLACE_ID } from "@/server/services/reviews";
import { secretStatus } from "@/server/services/secrets";
import { lastWebhookSeen, squareStatus } from "@/server/services/square";
import type { ServiceId, TestResult } from "./actions";
import { Connections, type ConnectionsData } from "./connections-client";

export const metadata = { title: "Connections" };

const SERVICES: ServiceId[] = ["square", "email", "push", "ai", "google"];
const isService = (s: string | undefined): s is ServiceId => !!s && (SERVICES as string[]).includes(s);

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ open?: string; error?: string; connected?: string }> }) {
  const me = await requireUser("MANAGER");
  const sp = await searchParams;
  const [secrets, square, origin, webhookSeen, devices, myEmail, profile, rows] = await Promise.all([
    secretStatus(),
    squareStatus(),
    publicOrigin(),
    lastWebhookSeen(),
    pushDeviceCount(),
    emailForUser(me.userId),
    getBusinessProfile(),
    db.setting.findMany({ where: { OR: [{ key: { startsWith: "connections.test." } }, { key: { in: [SETTING_PLACE_ID, "reviews.googlePlaceName"] } }] } }),
  ]);
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const tests = Object.fromEntries(
    SERVICES.map((id) => {
      const raw = get(`connections.test.${id}`);
      try {
        return [id, raw ? (JSON.parse(raw) as TestResult) : null];
      } catch {
        return [id, null];
      }
    }),
  ) as Record<ServiceId, TestResult | null>;

  // Strip anything that isn't the status (secret values never reach this page anyway).
  const byName = Object.fromEntries(SECRET_NAMES.map((n) => [n, secrets.find((s) => s.name === n)!])) as Record<SecretName, SecretStatus>;

  const data: ConnectionsData = {
    origin,
    local: isLocalOrigin(origin),
    redirectUrl: `${origin}${SQUARE_REDIRECT_PATH}`,
    webhookUrl: process.env.SQUARE_WEBHOOK_URL?.trim() || `${origin}${SQUARE_WEBHOOK_PATH}`,
    squareVersion: SQUARE_VERSION,
    secrets: byName,
    square: {
      connected: square.connected,
      merchantName: square.merchantName,
      locations: square.selectedCount,
      source: square.source,
      sandbox: square.environment === "sandbox",
      oauthReady: square.oauthAvailable,
      webhookSeen: webhookSeen?.toISOString() ?? null,
    },
    email: { me: myEmail },
    push: { devices },
    google: { placeId: get(SETTING_PLACE_ID), placeName: get("reviews.googlePlaceName"), businessName: profile.name },
    tests,
    open: isService(sp.open) ? sp.open : null,
    flash: sp.error ? { error: sp.error } : sp.connected ? { message: `Connected to ${sp.connected}. Next, bring in your sales history on the Square page.` } : null,
  };

  return (
    <>
      <PageHeader
        help="settings.connections"
        back={{ href: "/settings", label: "Settings" }}
        title="Connections"
        description="Link the outside services that turn extra features on. Each one has a step-by-step guide with pictures — no technical know-how needed, and everything works without them."
      />
      <Connections data={data} />
    </>
  );
}
