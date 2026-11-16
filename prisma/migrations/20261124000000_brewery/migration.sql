-- CreateEnum
CREATE TYPE "TankKind" AS ENUM ('FERMENTER', 'BRITE', 'OTHER');

-- CreateEnum
CREATE TYPE "BrewStatus" AS ENUM ('PLANNED', 'FERMENTING', 'CONDITIONING', 'PACKAGED', 'DUMPED');

-- CreateTable
CREATE TABLE "Tank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TankKind" NOT NULL DEFAULT 'FERMENTER',
    "capacityBbl" DECIMAL(6,2) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "Tank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewRecipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beerId" TEXT,
    "style" TEXT,
    "status" TEXT NOT NULL DEFAULT 'live',
    "batchBbl" DECIMAL(6,2) NOT NULL DEFAULT 7,
    "efficiencyPct" DECIMAL(5,2) NOT NULL DEFAULT 72,
    "boilMinutes" INTEGER NOT NULL DEFAULT 60,
    "targetOg" DECIMAL(5,3),
    "targetFg" DECIMAL(5,3),
    "fermentDays" INTEGER NOT NULL DEFAULT 14,
    "conditionDays" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT,
    "extra" JSONB,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrewRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewRecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredientId" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "potentialPpg" DECIMAL(5,2),
    "colorL" DECIMAL(6,1),
    "alphaPct" DECIMAL(4,1),
    "use" TEXT,
    "minutes" INTEGER,
    "attenuationPct" DECIMAL(4,1),
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BrewRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrewBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "recipeId" TEXT,
    "beerId" TEXT,
    "status" "BrewStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedOn" DATE,
    "brewedOn" DATE,
    "packagedOn" DATE,
    "bbl" DECIMAL(6,2),
    "og" DECIMAL(5,3),
    "fg" DECIMAL(5,3),
    "cost" DECIMAL(10,2),
    "kegBatchId" TEXT,
    "notes" TEXT,
    "extra" JSONB,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrewBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankStay" (
    "id" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE,
    "planned" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TankStay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tank_name_key" ON "Tank"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BrewRecipe_name_key" ON "BrewRecipe"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BrewRecipe_sourceKey_key" ON "BrewRecipe"("sourceKey");

-- CreateIndex
CREATE INDEX "BrewRecipe_beerId_idx" ON "BrewRecipe"("beerId");

-- CreateIndex
CREATE INDEX "BrewRecipeLine_recipeId_idx" ON "BrewRecipeLine"("recipeId");

-- CreateIndex
CREATE INDEX "BrewRecipeLine_ingredientId_idx" ON "BrewRecipeLine"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "BrewBatch_code_key" ON "BrewBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BrewBatch_kegBatchId_key" ON "BrewBatch"("kegBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "BrewBatch_sourceKey_key" ON "BrewBatch"("sourceKey");

-- CreateIndex
CREATE INDEX "BrewBatch_status_idx" ON "BrewBatch"("status");

-- CreateIndex
CREATE INDEX "BrewBatch_beerId_idx" ON "BrewBatch"("beerId");

-- CreateIndex
CREATE INDEX "TankStay_tankId_start_idx" ON "TankStay"("tankId", "start");

-- CreateIndex
CREATE INDEX "TankStay_batchId_idx" ON "TankStay"("batchId");

-- AddForeignKey
ALTER TABLE "BrewRecipe" ADD CONSTRAINT "BrewRecipe_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipeLine" ADD CONSTRAINT "BrewRecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "BrewRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewRecipeLine" ADD CONSTRAINT "BrewRecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewBatch" ADD CONSTRAINT "BrewBatch_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "BrewRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewBatch" ADD CONSTRAINT "BrewBatch_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewBatch" ADD CONSTRAINT "BrewBatch_kegBatchId_fkey" FOREIGN KEY ("kegBatchId") REFERENCES "KegBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankStay" ADD CONSTRAINT "TankStay_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "Tank"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankStay" ADD CONSTRAINT "TankStay_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BrewBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

