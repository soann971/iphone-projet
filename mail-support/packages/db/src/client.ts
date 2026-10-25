import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";

let prisma: PrismaClient | undefined;

/** Client Prisma partagé (un par processus). */
export function getDb(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!prisma) {
    if (!databaseUrl) throw new Error("DATABASE_URL manquant");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
  return prisma;
}

export async function disconnectDb() {
  await prisma?.$disconnect();
  prisma = undefined;
}

export type Db = PrismaClient;
