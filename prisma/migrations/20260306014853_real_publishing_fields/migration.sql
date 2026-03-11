-- AlterTable
ALTER TABLE "public"."PlatformConnection" ADD COLUMN     "configJson" TEXT,
ADD COLUMN     "externalAccountId" TEXT,
ADD COLUMN     "webhookUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "mediaUrl" TEXT;
