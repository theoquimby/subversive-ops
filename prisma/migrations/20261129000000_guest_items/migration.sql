-- CreateTable
CREATE TABLE "GuestItem" (
    "date" DATE NOT NULL,
    "guest" TEXT NOT NULL,
    "squareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(10,3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "GuestItem_pkey" PRIMARY KEY ("date","guest","squareId")
);

