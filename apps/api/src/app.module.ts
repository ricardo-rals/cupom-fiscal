import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { NormalizationQueue } from './normalization/normalization.queue.js';
import { NormalizationService } from './normalization/normalization.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ReceiptsController } from './receipts/receipts.controller.js';
import { ReceiptsService } from './receipts/receipts.service.js';
import { ReviewController } from './review/review.controller.js';
import { ReviewService } from './review/review.service.js';

@Module({
  controllers: [
    AppController,
    ReceiptsController,
    ReviewController,
    DashboardController,
  ],
  providers: [
    PrismaService,
    ReceiptsService,
    NormalizationService,
    NormalizationQueue,
    ReviewService,
    DashboardService,
  ],
})
export class AppModule {}
