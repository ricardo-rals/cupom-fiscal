import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AskController } from './ask/ask.controller.js';
import { AskService } from './ask/ask.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { ForecastController } from './forecast/forecast.controller.js';
import { ForecastService } from './forecast/forecast.service.js';
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
    ForecastController,
    AskController,
  ],
  providers: [
    // Toda rota exige login, menos as marcadas com @Publico().
    { provide: APP_GUARD, useClass: AuthGuard },
    PrismaService,
    ReceiptsService,
    NormalizationService,
    NormalizationQueue,
    ReviewService,
    DashboardService,
    ForecastService,
    AskService,
  ],
})
export class AppModule {}
