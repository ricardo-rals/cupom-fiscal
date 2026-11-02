import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ReviewService } from './review.service.js';

@Controller('review-queue')
export class ReviewController {
  constructor(private readonly revisao: ReviewService) {}

  @Get()
  listar() {
    return this.revisao.listar();
  }

  @Post(':itemId/resolve')
  @HttpCode(200)
  resolver(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() corpo: Parameters<ReviewService['resolver']>[1],
  ) {
    return this.revisao.resolver(itemId, corpo);
  }
}
