-- Tap list: board details per beer and a small label image. Additive only.

-- AlterTable
ALTER TABLE "Beer" ADD COLUMN "abv" DECIMAL(4,1),
ADD COLUMN "ibu" INTEGER,
ADD COLUMN "description" TEXT,
ADD COLUMN "diet" TEXT,
ADD COLUMN "boardPours" TEXT,
ADD COLUMN "comingSoon" BOOLEAN,
ADD COLUMN "labelAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BeerLabel" (
    "beerId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeerLabel_pkey" PRIMARY KEY ("beerId")
);

-- AddForeignKey
ALTER TABLE "BeerLabel" ADD CONSTRAINT "BeerLabel_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
