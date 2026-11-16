-- Linking sales: bought-in items carry a cost each (counted as linked), and a log of link changes for undo. Additive only.

-- AlterTable
ALTER TABLE "SquareMapping" ADD COLUMN     "costClass" TEXT,
ADD COLUMN     "unitCost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "LinkChange" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batch" TEXT NOT NULL,
    "userName" TEXT,
    "squareId" TEXT NOT NULL,
    "squareName" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "LinkChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkChange_at_idx" ON "LinkChange"("at");

-- CreateIndex
CREATE INDEX "LinkChange_batch_idx" ON "LinkChange"("batch");
