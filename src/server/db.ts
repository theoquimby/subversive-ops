import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Prisma Decimal | null → number | null. Money/quantities here are small enough for floats. */
export const num = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d == null ? null : typeof d === "number" ? d : d.toNumber();

export const numOr0 = (d: Prisma.Decimal | number | null | undefined) => num(d) ?? 0;
