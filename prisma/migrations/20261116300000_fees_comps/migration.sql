-- CreateTable
CREATE TABLE "SquareDayMoney" (
    "date" DATE NOT NULL,
    "cardFees" DECIMAL(10,2),
    "feesReturned" DECIMAL(10,2),
    "feePayments" INTEGER NOT NULL DEFAULT 0,
    "feePending" INTEGER NOT NULL DEFAULT 0,
    "feeVolume" DECIMAL(12,2),
    "feesSyncedAt" TIMESTAMP(3),
    "discounts" DECIMAL(10,2),
    "discountsSyncedAt" TIMESTAMP(3),

    CONSTRAINT "SquareDayMoney_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "SquareDiscount" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "squareId" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(10,2) NOT NULL,
    "qty" DECIMAL(10,3) NOT NULL,
    "full" BOOLEAN NOT NULL DEFAULT false,
    "percentage" TEXT,

    CONSTRAINT "SquareDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SquareDiscount_date_idx" ON "SquareDiscount"("date");

-- CreateIndex
CREATE INDEX "SquareDiscount_orderId_idx" ON "SquareDiscount"("orderId");
