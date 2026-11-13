-- CreateTable
CREATE TABLE "QuickBooksLink" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "qboId" TEXT,
    "syncToken" TEXT,
    "attachableId" TEXT,
    "hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBooksLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickBooksLink_kind_localId_idx" ON "QuickBooksLink"("kind", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBooksLink_realmId_kind_localId_key" ON "QuickBooksLink"("realmId", "kind", "localId");
