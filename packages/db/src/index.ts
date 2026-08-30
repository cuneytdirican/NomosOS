import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

let prisma: PrismaClient | undefined;

/** Süreç başına tek PrismaClient örneği. */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
