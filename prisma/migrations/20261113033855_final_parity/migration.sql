-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('PRAISE', 'COACHING', 'NOTE');

-- CreateEnum
CREATE TYPE "DocumentAudience" AS ENUM ('STAFF', 'MANAGER');

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WasteLog" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "sourceQty" DECIMAL(12,3),
ADD COLUMN     "sourceRecipeId" TEXT,
ADD COLUMN     "sourceUnit" TEXT;

-- CreateTable
CREATE TABLE "EmployeeFeedback" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "visibleToEmployee" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'POLICY',
    "bytes" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filename" TEXT,
    "text" TEXT,
    "requiresAck" BOOLEAN NOT NULL DEFAULT false,
    "audience" "DocumentAudience" NOT NULL DEFAULT 'STAFF',
    "uploadedBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAck" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeFeedback_employeeId_createdAt_idx" ON "EmployeeFeedback"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAck_documentId_employeeId_key" ON "DocumentAck"("documentId", "employeeId");

-- CreateIndex
CREATE INDEX "WasteLog_batchId_idx" ON "WasteLog"("batchId");

-- CreateIndex
CREATE INDEX "WasteLog_loggedAt_idx" ON "WasteLog"("loggedAt");

-- AddForeignKey
ALTER TABLE "WasteLog" ADD CONSTRAINT "WasteLog_sourceRecipeId_fkey" FOREIGN KEY ("sourceRecipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeFeedback" ADD CONSTRAINT "EmployeeFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeFeedback" ADD CONSTRAINT "EmployeeFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAck" ADD CONSTRAINT "DocumentAck_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAck" ADD CONSTRAINT "DocumentAck_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
