-- CreateEnum
CREATE TYPE "KegOrderStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "KegOrder" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "transit" TEXT NOT NULL DEFAULT 'DELIVERY',
    "dueOn" DATE,
    "status" "KegOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledByName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByName" TEXT,

    CONSTRAINT "KegOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "beerId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unscanned" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KegOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegOrderKeg" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "kegId" TEXT NOT NULL,
    "eventId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userName" TEXT,

    CONSTRAINT "KegOrderKeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KegOrderNote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "KegOrderNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KegOrder_number_key" ON "KegOrder"("number");

-- CreateIndex
CREATE INDEX "KegOrder_status_dueOn_idx" ON "KegOrder"("status", "dueOn");

-- CreateIndex
CREATE INDEX "KegOrder_accountId_idx" ON "KegOrder"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "KegOrderKeg_orderId_kegId_key" ON "KegOrderKeg"("orderId", "kegId");

-- AddForeignKey
ALTER TABLE "KegOrder" ADD CONSTRAINT "KegOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "KegAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderLine" ADD CONSTRAINT "KegOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "KegOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderLine" ADD CONSTRAINT "KegOrderLine_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderKeg" ADD CONSTRAINT "KegOrderKeg_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "KegOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderKeg" ADD CONSTRAINT "KegOrderKeg_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "KegOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderKeg" ADD CONSTRAINT "KegOrderKeg_kegId_fkey" FOREIGN KEY ("kegId") REFERENCES "Keg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KegOrderNote" ADD CONSTRAINT "KegOrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "KegOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

