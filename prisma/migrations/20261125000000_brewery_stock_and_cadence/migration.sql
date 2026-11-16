-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "department" TEXT NOT NULL DEFAULT 'kitchen',
ADD COLUMN     "orderCadence" TEXT NOT NULL DEFAULT 'regular';

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "department" TEXT NOT NULL DEFAULT 'kitchen';

-- AlterTable
ALTER TABLE "Tank" ADD COLUMN     "layoutCol" INTEGER,
ADD COLUMN     "layoutRow" INTEGER,
ADD COLUMN     "zone" TEXT;

-- AlterTable
ALTER TABLE "BrewRecipe" ADD COLUMN     "artworkDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dryHopDay" INTEGER,
ADD COLUMN     "mashF" DECIMAL(5,1),
ADD COLUMN     "mashMinutes" INTEGER,
ADD COLUMN     "profile" TEXT,
ADD COLUMN     "strikeF" DECIMAL(5,1),
ADD COLUMN     "tapDay" INTEGER,
ADD COLUMN     "targetBk" DECIMAL(6,4),
ADD COLUMN     "targetKo" DECIMAL(6,4),
ADD COLUMN     "targetMt" DECIMAL(6,4),
ALTER COLUMN "targetOg" SET DATA TYPE DECIMAL(6,4),
ALTER COLUMN "targetFg" SET DATA TYPE DECIMAL(6,4);

-- AlterTable
ALTER TABLE "BrewBatch" ADD COLUMN     "brewLog" JSONB,
ADD COLUMN     "cases" INTEGER,
ADD COLUMN     "co2Vols" DECIMAL(3,2),
ADD COLUMN     "dryHopOn" DATE,
ADD COLUMN     "halfKegs" INTEGER,
ADD COLUMN     "lockedReason" TEXT,
ADD COLUMN     "ordered" JSONB,
ADD COLUMN     "sixthKegs" INTEGER,
ADD COLUMN     "splitFromId" TEXT,
ADD COLUMN     "tapLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tapOn" DATE,
ALTER COLUMN "og" SET DATA TYPE DECIMAL(6,4),
ALTER COLUMN "fg" SET DATA TYPE DECIMAL(6,4);

-- CreateTable
CREATE TABLE "BrewStockMove" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,
    "batchId" TEXT,
    "note" TEXT,
    "userName" TEXT,

    CONSTRAINT "BrewStockMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrewStockMove_ingredientId_at_idx" ON "BrewStockMove"("ingredientId", "at");

-- CreateIndex
CREATE INDEX "BrewStockMove_batchId_idx" ON "BrewStockMove"("batchId");

-- AddForeignKey
ALTER TABLE "BrewBatch" ADD CONSTRAINT "BrewBatch_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "BrewBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewStockMove" ADD CONSTRAINT "BrewStockMove_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrewStockMove" ADD CONSTRAINT "BrewStockMove_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BrewBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Brewing ingredients made by the recipe pages belong to the brewery side
UPDATE "Ingredient" SET "department" = 'brewery' WHERE "category" IN ('Malt', 'Hops', 'Yeast', 'Brewing');
