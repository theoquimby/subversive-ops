import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BUSINESS_TIMEZONE: z.string().default("America/New_York"),
  SQUARE_ENVIRONMENT: z.enum(["production", "sandbox"]).default("production"),
  SQUARE_ACCESS_TOKEN: z.string().optional().default(""),
  SQUARE_LOCATION_ID: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
});

export const env = schema.parse(process.env);

export const squareConfigured = () => Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
