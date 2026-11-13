/**
 * npm run db:seed                  → demo data (logins Max/1234, Line/0000)
 * SEED_MODE=empty npm run db:seed  → wipe everything, create only the logins
 * SEED_MANAGER_PIN / SEED_STAFF_PIN override the PINs.
 */
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/server/demo-data";

const db = new PrismaClient();
seedDemo(db, {
  managerPin: process.env.SEED_MANAGER_PIN,
  staffPin: process.env.SEED_STAFF_PIN,
  mode: process.env.SEED_MODE === "empty" ? "empty" : "demo",
}).finally(() => db.$disconnect());
