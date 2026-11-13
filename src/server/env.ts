import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BUSINESS_TIMEZONE: z.string().default("America/New_York"),
  SQUARE_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),
  // The Square app's ID/secret and the webhook signature key are read through
  // getSecret() (src/server/services/secrets.ts): pasted in Settings → Connections,
  // with the same-named environment variables as a fallback.
  // Optional override for the webhook notification URL (default: derived from APP_URL / the request).
  SQUARE_WEBHOOK_URL: z.string().optional().default(""),
  // Legacy fallback: a token + location(s) set directly in the environment
  SQUARE_ACCESS_TOKEN: z.string().optional().default(""),
  SQUARE_LOCATION_ID: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
});

export const env = schema.parse(process.env);
