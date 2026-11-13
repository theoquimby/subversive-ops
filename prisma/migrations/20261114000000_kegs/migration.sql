-- CreateEnum
CREATE TYPE "KegStatus" AS ENUM ('EMPTY', 'FILLED', 'COLD', 'ON_TAP', 'KICKED', 'OUT', 'CLEANING');

-- CreateEnum
CREATE TYPE "KegOwner" AS ENUM ('OURS', 'DEPOSIT', 'BORROWED');

-- CreateTable
CREATE TABLE "Beer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "style" TEXT,
    "color" TEXT NOT NULL DEFAULT 'amber',
    "house" BOOLEAN NOT NULL DEFAULT true,
    "ingredientId" TEXT,
    "recipeId" TEXT,
    "squareNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minFull" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Beer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "beerId" TEXT,
    "brewedOn" DATE,
    "packagedOn" DATE,
    "notes" TEXT,
    "extra" JSONB,

    CONSTRAINT "KegBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegSpot" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KegSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bar',
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KegAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keg" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legacyCode" TEXT,
    "label" TEXT,
    "sizeId" TEXT NOT NULL DEFAULT 'half',
    "owner" "KegOwner" NOT NULL DEFAULT 'OURS',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" "KegStatus" NOT NULL DEFAULT 'EMPTY',
    "statusAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beerId" TEXT,
    "fillId" TEXT,
    "area" TEXT,
    "spotId" TEXT,
    "spotNote" TEXT,
    "tapLine" INTEGER,
    "accountId" TEXT,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegFill" (
    "id" TEXT NOT NULL,
    "kegId" TEXT NOT NULL,
    "beerId" TEXT,
    "batchId" TEXT,
    "batchCode" TEXT,
    "filledOn" DATE,
    "bestBy" DATE,
    "tappedAt" TIMESTAMP(3),
    "tapLine" INTEGER,
    "kickedAt" TIMESTAMP(3),
    "importKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KegFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegEvent" (
    "id" TEXT NOT NULL,
    "kegId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "KegStatus",
    "toStatus" "KegStatus",
    "fromPlace" TEXT,
    "toPlace" TEXT,
    "beerId" TEXT,
    "fillId" TEXT,
    "tapLine" INTEGER,
    "accountId" TEXT,
    "note" TEXT,
    "before" JSONB,
    "groupId" TEXT,
    "undoneAt" TIMESTAMP(3),
    "clientId" TEXT,
    "importKey" TEXT,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KegEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Beer_name_key" ON "Beer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "KegBatch_code_key" ON "KegBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "KegSpot_area_name_key" ON "KegSpot"("area", "name");

-- CreateIndex
CREATE UNIQUE INDEX "KegAccount_name_key" ON "KegAccount"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Keg_code_key" ON "Keg"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Keg_legacyCode_key" ON "Keg"("legacyCode");

-- CreateIndex
CREATE UNIQUE INDEX "Keg_fillId_key" ON "Keg"("fillId");

-- CreateIndex
CREATE INDEX "Keg_status_idx" ON "Keg"("status");

-- CreateIndex
CREATE INDEX "Keg_beerId_idx" ON "Keg"("beerId");

-- CreateIndex
CREATE UNIQUE INDEX "KegFill_importKey_key" ON "KegFill"("importKey");

-- CreateIndex
CREATE INDEX "KegFill_beerId_kickedAt_idx" ON "KegFill"("beerId", "kickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KegEvent_clientId_key" ON "KegEvent"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "KegEvent_importKey_key" ON "KegEvent"("importKey");

-- CreateIndex
CREATE INDEX "KegEvent_kegId_at_idx" ON "KegEvent"("kegId", "at");

-- CreateIndex
CREATE INDEX "KegEvent_at_idx" ON "KegEvent"("at");

-- AddForeignKey
ALTER TABLE "KegBatch" ADD CONSTRAINT "KegBatch_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_fillId_fkey" FOREIGN KEY ("fillId") REFERENCES "KegFill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "KegSpot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keg" ADD CONSTRAINT "Keg_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "KegAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegFill" ADD CONSTRAINT "KegFill_kegId_fkey" FOREIGN KEY ("kegId") REFERENCES "Keg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegFill" ADD CONSTRAINT "KegFill_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegFill" ADD CONSTRAINT "KegFill_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "KegBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegEvent" ADD CONSTRAINT "KegEvent_kegId_fkey" FOREIGN KEY ("kegId") REFERENCES "Keg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegEvent" ADD CONSTRAINT "KegEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "KegAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

