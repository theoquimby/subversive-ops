-- AlterTable
ALTER TABLE "WeatherDay" ADD COLUMN     "apparentMaxC" DECIMAL(5,1),
ADD COLUMN     "precipDayMm" DECIMAL(6,1),
ADD COLUMN     "snowCm" DECIMAL(5,1),
ADD COLUMN     "windMaxKph" DECIMAL(5,1);

-- CreateTable
CREATE TABLE "ForecastLog" (
    "id" TEXT NOT NULL,
    "madeOn" DATE NOT NULL,
    "date" DATE NOT NULL,
    "horizon" INTEGER NOT NULL,
    "sales" DECIMAL(12,2) NOT NULL,
    "baseline" DECIMAL(12,2) NOT NULL,
    "weatherFactor" DECIMAL(6,3) NOT NULL,
    "eventFactor" DECIMAL(6,3) NOT NULL,
    "manual" DECIMAL(6,3) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "ForecastLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastLog_date_idx" ON "ForecastLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastLog_madeOn_date_model_key" ON "ForecastLog"("madeOn", "date", "model");

