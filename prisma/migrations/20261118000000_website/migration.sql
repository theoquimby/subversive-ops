-- Website (additive only): web fields for menu items, sections, beers and events; uploaded images; website inquiries. Event gains updatedAt.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "WebMenuItem" (
    "recipeId" TEXT NOT NULL,
    "onWebsite" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "badge" TEXT,
    "modifiers" TEXT,
    "place" TEXT,
    "section" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "availableFrom" DATE,
    "availableUntil" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebMenuItem_pkey" PRIMARY KEY ("recipeId")
);

-- CreateTable
CREATE TABLE "WebMenuSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT 'food',
    "intro" TEXT,
    "note" TEXT,
    "modifiers" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "availableFrom" DATE,
    "availableUntil" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebMenuSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebBeer" (
    "beerId" TEXT NOT NULL,
    "onWebsite" BOOLEAN NOT NULL DEFAULT true,
    "family" TEXT,
    "badge" TEXT,
    "hazy" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebBeer_pkey" PRIMARY KEY ("beerId")
);

-- CreateTable
CREATE TABLE "WebEvent" (
    "eventId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "webKind" TEXT,
    "closed" BOOLEAN,
    "imageId" TEXT,
    "imageAlt" TEXT,
    "ticketUrl" TEXT,
    "rsvpUrl" TEXT,
    "priceLabel" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "kitchenCloseOverride" TEXT,
    "barCloseOverride" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "WebImage" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebInquiry" (
    "id" TEXT NOT NULL,
    "privateEventId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "date" DATE,
    "guests" INTEGER,
    "type" TEXT,
    "message" TEXT,
    "ipHash" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebEvent_slug_key" ON "WebEvent"("slug");

-- CreateIndex
CREATE INDEX "WebInquiry_ipHash_createdAt_idx" ON "WebInquiry"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "WebInquiry_createdAt_idx" ON "WebInquiry"("createdAt");

