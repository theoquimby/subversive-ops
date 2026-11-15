-- Shift notes / handoff (additive only): one row per end-of-shift note.
CREATE TABLE "ShiftNote" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'close',
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "eightySixed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issues" TEXT,
    "comps" TEXT,
    "compsAmount" DECIMAL(10,2),
    "cash" TEXT,
    "cashOverShort" DECIMAL(10,2),
    "maintenance" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftNote_date_idx" ON "ShiftNote"("date");
CREATE INDEX "ShiftNote_createdAt_idx" ON "ShiftNote"("createdAt");
