-- CreateEnum
CREATE TYPE "TimeOffType" AS ENUM ('PTO', 'SICK', 'UNPAID');

-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('OPEN', 'APPROVED');

-- AlterTable
ALTER TABLE "TimeOffRequest" ADD COLUMN     "hours" DECIMAL(6,2),
ADD COLUMN     "type" "TimeOffType" NOT NULL DEFAULT 'UNPAID';

-- AlterTable
ALTER TABLE "Timecard" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "manuallyEdited" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BONUS',
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayAdjustment_date_idx" ON "PayAdjustment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_startDate_endDate_key" ON "PayPeriod"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- AddForeignKey
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
