import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { getPrisma, type PrismaClient } from "@nomosos/db";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = getPrisma();

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
