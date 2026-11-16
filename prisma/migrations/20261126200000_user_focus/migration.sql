-- AlterTable
ALTER TABLE "User" ADD COLUMN     "focus" TEXT[] DEFAULT ARRAY[]::TEXT[];
