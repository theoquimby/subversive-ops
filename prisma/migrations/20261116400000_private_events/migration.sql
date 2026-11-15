-- Private events & parties (additive only): bookings, quote lines, payments and per-person packages.

-- CreateTable
CREATE TABLE "PrivateEvent" (
    "id" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'INQUIRY',
    "clientName" TEXT NOT NULL,
    "company" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PARTY',
    "date" DATE,
    "startTime" TEXT,
    "endTime" TEXT,
    "space" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "notes" TEXT,
    "followUpOn" DATE,
    "lostReason" TEXT,
    "calendarEventId" TEXT,
    "roomFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "barKind" TEXT NOT NULL DEFAULT 'NONE',
    "drinkTickets" INTEGER NOT NULL DEFAULT 0,
    "ticketPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "barAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "serviceChargePct" DECIMAL(5,4) NOT NULL DEFAULT 0.2,
    "taxPct" DECIMAL(5,4) NOT NULL DEFAULT 0.08,
    "depositPct" DECIMAL(5,4) NOT NULL DEFAULT 0.25,
    "depositAmount" DECIMAL(10,2),
    "depositDueOn" DATE,
    "balanceDueOn" DATE,
    "quoteNote" TEXT,
    "quoteToken" TEXT,
    "quoteSentAt" TIMESTAMP(3),
    "quoteViewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedName" TEXT,
    "acceptedQuote" JSONB,
    "paymentLinkUrl" TEXT,
    "paymentLinkId" TEXT,
    "paymentLinkAmount" DECIMAL(10,2),
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateEventLine" (
    "id" TEXT NOT NULL,
    "privateEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ITEM',
    "recipeId" TEXT,
    "packageId" TEXT,
    "label" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "perPerson" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(10,4),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateEventLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateEventPayment" (
    "id" TEXT NOT NULL,
    "privateEventId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "method" TEXT NOT NULL DEFAULT 'CARD',
    "paidOn" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateEventPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateEventPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePerPerson" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateEventPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateEventPackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "perGuest" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PrivateEventPackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrivateEvent_calendarEventId_key" ON "PrivateEvent"("calendarEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateEvent_quoteToken_key" ON "PrivateEvent"("quoteToken");

-- CreateIndex
CREATE INDEX "PrivateEvent_stage_date_idx" ON "PrivateEvent"("stage", "date");

-- CreateIndex
CREATE INDEX "PrivateEvent_date_idx" ON "PrivateEvent"("date");

-- CreateIndex
CREATE INDEX "PrivateEventLine_privateEventId_sort_idx" ON "PrivateEventLine"("privateEventId", "sort");

-- CreateIndex
CREATE INDEX "PrivateEventPayment_privateEventId_idx" ON "PrivateEventPayment"("privateEventId");

-- CreateIndex
CREATE INDEX "PrivateEventPackageItem_packageId_idx" ON "PrivateEventPackageItem"("packageId");

-- AddForeignKey
ALTER TABLE "PrivateEventLine" ADD CONSTRAINT "PrivateEventLine_privateEventId_fkey" FOREIGN KEY ("privateEventId") REFERENCES "PrivateEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateEventPayment" ADD CONSTRAINT "PrivateEventPayment_privateEventId_fkey" FOREIGN KEY ("privateEventId") REFERENCES "PrivateEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateEventPackageItem" ADD CONSTRAINT "PrivateEventPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PrivateEventPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
