import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ReceiptsController } from './receipts/receipts.controller.js';
import { ReceiptsService } from './receipts/receipts.service.js';

@Module({
  controllers: [AppController, ReceiptsController],
  providers: [PrismaService, ReceiptsService],
})
export class AppModule {}
