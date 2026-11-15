-- Prep list (additive only): per-item prep settings, prep on-hand counts and what was made each day.
CREATE TABLE "PrepSetting" (
    "recipeId" TEXT NOT NULL,
    "onList" BOOLEAN NOT NULL DEFAULT true,
    "parBase" DECIMAL(14,4),
    "shelfLifeDays" INTEGER,
    "rounding" TEXT NOT NULL DEFAULT 'batch',
    "station" TEXT,
    "unitName" TEXT,
    "unitBase" DECIMAL(14,4),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrepSetting_pkey" PRIMARY KEY ("recipeId")
);

CREATE TABLE "PrepCount" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedBy" TEXT,
    "clientId" TEXT,
    CONSTRAINT "PrepCount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrepCount_clientId_key" ON "PrepCount"("clientId");
CREATE INDEX "PrepCount_recipeId_countedAt_idx" ON "PrepCount"("recipeId", "countedAt");

CREATE TABLE "PrepDone" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "qtyBase" DECIMAL(14,4) NOT NULL,
    "doneBy" TEXT,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    CONSTRAINT "PrepDone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrepDone_clientId_key" ON "PrepDone"("clientId");
CREATE UNIQUE INDEX "PrepDone_recipeId_day_key" ON "PrepDone"("recipeId", "day");
CREATE INDEX "PrepDone_day_idx" ON "PrepDone"("day");
