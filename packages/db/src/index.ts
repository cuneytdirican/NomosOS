import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export { buildJudicialCatalog, ILLER } from "./judicial-catalog";

let prisma: PrismaClient | undefined;

/** Süreç başına tek PrismaClient örneği. */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
