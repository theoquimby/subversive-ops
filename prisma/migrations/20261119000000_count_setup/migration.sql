-- Count setup: photos, how-to notes, shelf order, allowed units and count frequency per item; prep items on the inventory count;
-- staff counts wait for a manager's approval; mixed-unit count lines. Additive only.

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "countAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "countEvery" TEXT NOT NULL DEFAULT 'every',
ADD COLUMN     "countNote" TEXT,
ADD COLUMN     "countOrder" INTEGER,
ADD COLUMN     "countUnits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "photoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "countArea" TEXT,
ADD COLUMN     "countAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "countEvery" TEXT NOT NULL DEFAULT 'every',
ADD COLUMN     "countNote" TEXT,
ADD COLUMN     "countOrder" INTEGER,
ADD COLUMN     "countUnit" TEXT,
ADD COLUMN     "countUnits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "photoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockCount" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "staffNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StockCountLine" ADD COLUMN     "parts" JSONB;

-- CreateTable
CREATE TABLE "CountPhoto" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT,
    "recipeId" TEXT,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeCountUnit" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseQty" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "RecipeCountUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountPrepLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,
    "parts" JSONB,

    CONSTRAINT "StockCountPrepLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CountPhoto_ingredientId_key" ON "CountPhoto"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "CountPhoto_recipeId_key" ON "CountPhoto"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeCountUnit_recipeId_unit_key" ON "RecipeCountUnit"("recipeId", "unit");

-- CreateIndex
CREATE INDEX "StockCountPrepLine_recipeId_idx" ON "StockCountPrepLine"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountPrepLine_countId_recipeId_key" ON "StockCountPrepLine"("countId", "recipeId");

-- AddForeignKey
ALTER TABLE "CountPhoto" ADD CONSTRAINT "CountPhoto_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountPhoto" ADD CONSTRAINT "CountPhoto_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeCountUnit" ADD CONSTRAINT "RecipeCountUnit_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountPrepLine" ADD CONSTRAINT "StockCountPrepLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountPrepLine" ADD CONSTRAINT "StockCountPrepLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

