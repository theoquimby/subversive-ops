-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'close',
    "positionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "href" TEXT,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "signedOffAt" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "signedOffName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTick" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT NOT NULL,

    CONSTRAINT "ChecklistTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT 'Bar',
    "make" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "vendor" TEXT,
    "vendorPhone" TEXT,
    "installedOn" DATE,
    "warrantyUntil" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpkeepTask" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT,
    "title" TEXT NOT NULL,
    "everyDays" INTEGER NOT NULL,
    "lastDoneOn" DATE,
    "staffCanDo" BOOLEAN NOT NULL DEFAULT false,
    "vendor" TEXT,
    "howTo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpkeepTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpkeepLog" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'done',
    "taskId" TEXT,
    "equipmentId" TEXT,
    "title" TEXT NOT NULL,
    "cost" DECIMAL(10,2),
    "vendor" TEXT,
    "down" BOOLEAN NOT NULL DEFAULT false,
    "fixedOn" DATE,
    "note" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpkeepLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeerTaxAdjustment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "gallons" DECIMAL(10,2) NOT NULL,
    "beerId" TEXT,
    "note" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeerTaxAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeerTaxFiling" (
    "id" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "filedOn" DATE NOT NULL,
    "amount" DECIMAL(10,2),
    "note" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeerTaxFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistItem_templateId_sort_idx" ON "ChecklistItem"("templateId", "sort");

-- CreateIndex
CREATE INDEX "ChecklistRun_date_idx" ON "ChecklistRun"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistRun_templateId_date_key" ON "ChecklistRun"("templateId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTick_runId_itemId_key" ON "ChecklistTick"("runId", "itemId");

-- CreateIndex
CREATE INDEX "UpkeepLog_date_idx" ON "UpkeepLog"("date");

-- CreateIndex
CREATE INDEX "UpkeepLog_equipmentId_date_idx" ON "UpkeepLog"("equipmentId", "date");

-- CreateIndex
CREATE INDEX "BeerTaxAdjustment_date_idx" ON "BeerTaxAdjustment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BeerTaxFiling_form_periodStart_key" ON "BeerTaxFiling"("form", "periodStart");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRun" ADD CONSTRAINT "ChecklistRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTick" ADD CONSTRAINT "ChecklistTick_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ChecklistRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTick" ADD CONSTRAINT "ChecklistTick_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpkeepTask" ADD CONSTRAINT "UpkeepTask_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpkeepLog" ADD CONSTRAINT "UpkeepLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "UpkeepTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpkeepLog" ADD CONSTRAINT "UpkeepLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

