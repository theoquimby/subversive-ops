-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('g', 'ml', 'each');

-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('DISTRIBUTOR', 'LOCAL');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('IMPORT', 'MANUAL', 'SCRAPE');

-- CreateEnum
CREATE TYPE "RecipeKind" AS ENUM ('MENU', 'PREP', 'MODIFIER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SupplierKind" NOT NULL DEFAULT 'DISTRIBUTOR',
    "email" TEXT,
    "deliveryDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "minOrder" DECIMAL(10,2),
    "importMapping" JSONB,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "storageArea" TEXT NOT NULL DEFAULT 'Dry storage',
    "baseUnit" "BaseUnit" NOT NULL,
    "yieldPct" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "safetyPct" DECIMAL(5,4) NOT NULL DEFAULT 0.15,
    "preferredProductId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseQty" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "packText" TEXT,
    "purchaseUnit" TEXT NOT NULL DEFAULT 'case',
    "packQtyBase" DECIMAL(14,4),
    "url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRecord" (
    "id" TEXT NOT NULL,
    "supplierProductId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" "PriceSource" NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceImport" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "newProducts" INTEGER NOT NULL,
    "priceChanges" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RecipeKind" NOT NULL DEFAULT 'MENU',
    "category" TEXT NOT NULL DEFAULT 'Food',
    "menuPrice" DECIMAL(10,2),
    "yieldQty" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "yieldUnit" TEXT NOT NULL DEFAULT 'each',
    "yieldBase" "BaseUnit" NOT NULL DEFAULT 'each',
    "targetFoodCostPct" DECIMAL(5,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "subRecipeId" TEXT,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareMapping" (
    "squareId" TEXT NOT NULL,
    "squareName" TEXT NOT NULL,
    "squareType" TEXT NOT NULL,
    "recipeId" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SquareMapping_pkey" PRIMARY KEY ("squareId")
);

-- CreateTable
CREATE TABLE "DailySale" (
    "date" DATE NOT NULL,
    "squareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "netSales" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "DailySale_pkey" PRIMARY KEY ("date","squareId")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "area" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteLog" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "loggedBy" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WasteLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryDate" DATE NOT NULL,
    "coverUntil" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierProductId" TEXT NOT NULL,
    "suggestedQty" DECIMAL(10,2) NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(10,2),
    "receivedQty" DECIMAL(10,2),

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_preferredProductId_key" ON "Ingredient"("preferredProductId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_ingredientId_unit_key" ON "UnitConversion"("ingredientId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_sku_key" ON "SupplierProduct"("supplierId", "sku");

-- CreateIndex
CREATE INDEX "PriceRecord_supplierProductId_effectiveDate_idx" ON "PriceRecord"("supplierProductId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_name_key" ON "Recipe"("name");

-- CreateIndex
CREATE INDEX "DailySale_squareId_idx" ON "DailySale"("squareId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_ingredientId_key" ON "StockCountLine"("countId", "ingredientId");

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_preferredProductId_fkey" FOREIGN KEY ("preferredProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecord" ADD CONSTRAINT "PriceRecord_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecord" ADD CONSTRAINT "PriceRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "PriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceImport" ADD CONSTRAINT "PriceImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareMapping" ADD CONSTRAINT "SquareMapping_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLog" ADD CONSTRAINT "WasteLog_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
