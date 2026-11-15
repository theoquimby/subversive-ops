-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_supplierProductId_idx" ON "InvoiceLine"("supplierProductId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_deliveryDate_idx" ON "PurchaseOrder"("status", "deliveryDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_idx" ON "PurchaseOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_supplierProductId_idx" ON "PurchaseOrderLine"("supplierProductId");

-- CreateIndex
CREATE INDEX "RecipeLine_recipeId_idx" ON "RecipeLine"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeLine_subRecipeId_idx" ON "RecipeLine"("subRecipeId");

-- CreateIndex
CREATE INDEX "RecipeLine_ingredientId_idx" ON "RecipeLine"("ingredientId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_start_idx" ON "Shift"("employeeId", "start");

-- CreateIndex
CREATE INDEX "ShiftSwap_status_idx" ON "ShiftSwap"("status");

-- CreateIndex
CREATE INDEX "SquareMapping_recipeId_idx" ON "SquareMapping"("recipeId");

-- CreateIndex
CREATE INDEX "StockCount_completed_takenAt_idx" ON "StockCount"("completed", "takenAt");

-- CreateIndex
CREATE INDEX "StockCountLine_ingredientId_idx" ON "StockCountLine"("ingredientId");

-- CreateIndex
CREATE INDEX "SupplierProduct_ingredientId_idx" ON "SupplierProduct"("ingredientId");

-- CreateIndex
CREATE INDEX "TimeOffRequest_status_idx" ON "TimeOffRequest"("status");

-- CreateIndex
CREATE INDEX "Timecard_employeeId_clockIn_idx" ON "Timecard"("employeeId", "clockIn");

-- CreateIndex
CREATE INDEX "WasteLog_ingredientId_idx" ON "WasteLog"("ingredientId");

