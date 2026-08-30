-- CreateEnum
CREATE TYPE "RecessExtensionRule" AS ENUM ('HMK_104', 'IYUK_8', 'CMK_331');

-- CreateEnum
CREATE TYPE "ProcedureCode" AS ENUM ('HMK', 'IIK', 'CMK', 'IYUK');

-- DropIndex
DROP INDEX "Holiday_date_type_key";

-- AlterTable
ALTER TABLE "Deadline" ALTER COLUMN "dueDate" SET DATA TYPE DATE;

-- AlterTable
ALTER TABLE "DeadlineRule" ADD COLUMN     "judicialRecessApplies" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "procedureCode" "ProcedureCode" NOT NULL DEFAULT 'HMK',
ADD COLUMN     "recessRule" "RecessExtensionRule" NOT NULL DEFAULT 'HMK_104';

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "isApproximate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isHalfDay" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_type_name_key" ON "Holiday"("date", "type", "name");

