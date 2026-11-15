-- Website analytics (first-party, cookieless) and Google Search Console / Business Profile (additive only).

-- CreateTable
CREATE TABLE "WebHit" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "referrer" TEXT,
    "device" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "props" JSONB,

    CONSTRAINT "WebHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebDaily" (
    "day" DATE NOT NULL,
    "dim" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "engaged" INTEGER NOT NULL DEFAULT 0,
    "converted" INTEGER NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WebDaily_pkey" PRIMARY KEY ("day","dim","key")
);

-- CreateTable
CREATE TABLE "WebConversion" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT,
    "path" TEXT,
    "privateEventId" TEXT,
    "props" JSONB,

    CONSTRAINT "WebConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleSearchDaily" (
    "day" DATE NOT NULL,
    "dim" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DECIMAL(7,2) NOT NULL,

    CONSTRAINT "GoogleSearchDaily_pkey" PRIMARY KEY ("day","dim","key")
);

-- CreateTable
CREATE TABLE "GoogleProfileDaily" (
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "GoogleProfileDaily_pkey" PRIMARY KEY ("day","metric")
);

-- CreateTable
CREATE TABLE "GoogleProfileKeyword" (
    "month" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "value" INTEGER,
    "threshold" INTEGER,

    CONSTRAINT "GoogleProfileKeyword_pkey" PRIMARY KEY ("month","keyword")
);

-- CreateIndex
CREATE INDEX "WebHit_day_idx" ON "WebHit"("day");

-- CreateIndex
CREATE INDEX "WebHit_visitor_at_idx" ON "WebHit"("visitor", "at");

-- CreateIndex
CREATE INDEX "WebHit_kind_day_idx" ON "WebHit"("kind", "day");

-- CreateIndex
CREATE INDEX "WebDaily_dim_day_idx" ON "WebDaily"("dim", "day");

-- CreateIndex
CREATE INDEX "WebConversion_day_idx" ON "WebConversion"("day");

-- CreateIndex
CREATE INDEX "WebConversion_privateEventId_idx" ON "WebConversion"("privateEventId");

-- CreateIndex
CREATE INDEX "GoogleSearchDaily_dim_day_idx" ON "GoogleSearchDaily"("dim", "day");
