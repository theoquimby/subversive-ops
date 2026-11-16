-- CreateTable
CREATE TABLE "AppFeedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "role" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'idea',
    "body" TEXT NOT NULL,
    "path" TEXT,
    "pageTitle" TEXT,
    "device" TEXT,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "note" TEXT,
    "photoMime" TEXT,
    "photo" BYTEA,

    CONSTRAINT "AppFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppFeedback_status_createdAt_idx" ON "AppFeedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AppFeedback_userId_idx" ON "AppFeedback"("userId");

-- AddForeignKey
ALTER TABLE "AppFeedback" ADD CONSTRAINT "AppFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

