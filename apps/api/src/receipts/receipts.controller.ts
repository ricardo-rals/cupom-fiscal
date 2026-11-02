import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ReviewService } from '../review/review.service.js';
import { ReceiptsService } from './receipts.service.js';

const URL_MAX = 2048;

@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly revisao: ReviewService,
  ) {}

  @Get()
  listar() {
    return this.receipts.listar();
  }

  @Get(':id')
  situacao(@Param('id', ParseIntPipe) id: number) {
    return this.receipts.situacao(id);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.receipts.atualizar(id, corpo);
  }

  @Patch(':id/items/:itemId')
  atualizarItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.receipts.atualizarItem(id, itemId, corpo);
  }

  @Post('items/:itemId/normalization')
  @HttpCode(200)
  corrigir(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() corpo: Parameters<ReviewService['corrigir']>[1],
  ) {
    return this.revisao.corrigir(itemId, corpo);
  }

  @Post(':id/normalize')
  @HttpCode(200)
  retomar(@Param('id', ParseIntPipe) id: number) {
    return this.receipts.retomar(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirmar(@Param('id', ParseIntPipe) id: number) {
    return this.receipts.confirmar(id);
  }

  @Post('qr')
  importarPorQr(@Body() body: { url?: unknown } | undefined) {
    const url = body?.url;
    if (typeof url !== 'string' || !url.trim() || url.length > URL_MAX) {
      throw new BadRequestException({ erro: 'url_invalida' });
    }
    return this.receipts.importarPorQr(url);
  }
}
