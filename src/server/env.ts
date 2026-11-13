import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BUSINESS_TIMEZONE: z.string().default("America/New_York"),
  SQUARE_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),
  // OAuth app (Square Developer Dashboard → your app → Credentials / OAuth)
  SQUARE_APPLICATION_ID: z.string().optional().default(""),
  SQUARE_APPLICATION_SECRET: z.string().optional().default(""),
  // Webhook subscription signature key, and the exact notification URL registered with Square
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().optional().default(""),
  SQUARE_WEBHOOK_URL: z.string().optional().default(""),
  // Legacy fallback: a token + location(s) set directly in the environment
  SQUARE_ACCESS_TOKEN: z.string().optional().default(""),
  SQUARE_LOCATION_ID: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
});

export const env = schema.parse(process.env);

/** OAuth "Connect Square" is available when the app credentials are set. */
export const squareOAuthConfigured = () => Boolean(env.SQUARE_APPLICATION_ID && env.SQUARE_APPLICATION_SECRET);
