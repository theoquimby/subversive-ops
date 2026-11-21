-- CreateTable
CREATE TABLE "GuestPlace" (
    "guest" TEXT NOT NULL,
    "postal" TEXT,
    "source" TEXT NOT NULL,
    "checkedOn" DATE NOT NULL,

    CONSTRAINT "GuestPlace_pkey" PRIMARY KEY ("guest")
);

-- CreateIndex
CREATE INDEX "GuestPlace_postal_idx" ON "GuestPlace"("postal");
