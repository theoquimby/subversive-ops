-- AlterTable
ALTER TABLE "TipAllocation" ADD COLUMN     "cardAmount" DECIMAL(10,2),
ADD COLUMN     "cashAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "TipPeriod" ADD COLUMN     "cardMode" TEXT NOT NULL DEFAULT 'POOL',
ADD COLUMN     "cardTips" DECIMAL(10,2),
ADD COLUMN     "cashMode" TEXT NOT NULL DEFAULT 'POOL',
ADD COLUMN     "cashTips" DECIMAL(10,2),
ADD COLUMN     "overrides" JSONB,
ADD COLUMN     "snapshot" JSONB;

-- CreateTable
CREATE TABLE "SquareTip" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(10,2) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquareTip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareTip_date_idx" ON "SquareTip"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SquareTip_date_kind_teamMemberId_key" ON "SquareTip"("date", "kind", "teamMemberId");

