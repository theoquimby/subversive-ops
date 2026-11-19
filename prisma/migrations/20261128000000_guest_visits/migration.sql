-- CreateTable
CREATE TABLE "GuestVisit" (
    "date" DATE NOT NULL,
    "guest" TEXT NOT NULL,
    "payments" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "GuestVisit_pkey" PRIMARY KEY ("date","guest")
);

-- CreateTable
CREATE TABLE "GuestDay" (
    "date" DATE NOT NULL,
    "payments" INTEGER NOT NULL,
    "identified" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "identifiedAmount" DECIMAL(12,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestDay_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "GuestVisit_guest_idx" ON "GuestVisit"("guest");

