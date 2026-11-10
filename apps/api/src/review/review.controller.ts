import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Usuario } from '../auth/auth.guard.js';
import { ReviewService } from './review.service.js';

@Controller('review-queue')
export class ReviewController {
  constructor(private readonly revisao: ReviewService) {}

  @Get()
  listar(@Usuario() usuario: number) {
    return this.revisao.listar(usuario);
  }

  @Get('categories')
  categorias() {
    return this.revisao.categorias();
  }

  @Post(':itemId/resolve')
  @HttpCode(200)
  resolver(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Usuario() usuario: number,
    @Body() corpo: Parameters<ReviewService['resolver']>[2],
  ) {
    return this.revisao.resolver(itemId, usuario, corpo);
  }
}
