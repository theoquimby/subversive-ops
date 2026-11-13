-- Invoice & receipt autopilot (additive only): receipts, due date, payment method,
-- extra pages, and per-line kind / pack size / ordered quantity.
ALTER TABLE "Invoice" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'invoice';
ALTER TABLE "Invoice" ADD COLUMN "dueDate" DATE;
ALTER TABLE "Invoice" ADD COLUMN "paymentMethod" TEXT;

ALTER TABLE "InvoiceLine" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'item';
ALTER TABLE "InvoiceLine" ADD COLUMN "packText" TEXT;
ALTER TABLE "InvoiceLine" ADD COLUMN "orderedQty" DECIMAL(10,2);

CREATE TABLE "InvoicePage" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoicePage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoicePage_invoiceId_position_idx" ON "InvoicePage"("invoiceId", "position");
ALTER TABLE "InvoicePage" ADD CONSTRAINT "InvoicePage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
