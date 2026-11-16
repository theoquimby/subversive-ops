-- AlterTable
ALTER TABLE "WebEvent" ADD COLUMN     "heroAlt" TEXT,
ADD COLUMN     "heroImageId" TEXT,
ADD COLUMN     "page" JSONB;

-- CreateTable
CREATE TABLE "WebAnnouncement" (
    "id" TEXT NOT NULL,
    "publicId" VARCHAR(64) NOT NULL,
    "text" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'info',
    "linkHref" TEXT,
    "linkLabel" TEXT,
    "from" DATE,
    "until" DATE,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAnnouncement_publicId_key" ON "WebAnnouncement"("publicId");

-- CreateIndex
CREATE INDEX "WebAnnouncement_active_sort_idx" ON "WebAnnouncement"("active", "sort");

