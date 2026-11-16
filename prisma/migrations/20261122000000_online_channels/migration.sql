-- CreateTable
CREATE TABLE "OnlineChannelDaily" (
    "channel" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "OnlineChannelDaily_pkey" PRIMARY KEY ("channel","day","metric")
);

-- CreateTable
CREATE TABLE "OnlinePost" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "permalink" TEXT,
    "thumbnailUrl" TEXT,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "interactions" INTEGER,
    "profileVisits" INTEGER,
    "follows" INTEGER,
    "extra" JSONB,
    "metricsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlinePost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnlineChannelDaily_channel_metric_day_idx" ON "OnlineChannelDaily"("channel", "metric", "day");

-- CreateIndex
CREATE INDEX "OnlinePost_channel_postedAt_idx" ON "OnlinePost"("channel", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePost_channel_externalId_key" ON "OnlinePost"("channel", "externalId");

