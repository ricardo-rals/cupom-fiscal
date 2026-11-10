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
import { Usuario } from '../auth/auth.guard.js';
import { ReviewService } from '../review/review.service.js';
import { ReceiptsService } from './receipts.service.js';

const URL_MAX = 2048;

function usarIa(valor: unknown) {
  if (valor === undefined || typeof valor === 'boolean') return valor;
  throw new BadRequestException({ erro: 'campo_invalido', campo: 'usar_ia' });
}

@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly revisao: ReviewService,
  ) {}

  @Get()
  listar(@Usuario() usuario: number) {
    return this.receipts.listar(usuario);
  }

  @Get(':id')
  situacao(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: number) {
    return this.receipts.situacao(id, usuario);
  }

  @Patch(':id')
  atualizar(
    @Param('id', ParseIntPipe) id: number,
    @Usuario() usuario: number,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.receipts.atualizar(id, usuario, corpo);
  }

  @Patch(':id/items/:itemId')
  atualizarItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Usuario() usuario: number,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.receipts.atualizarItem(id, usuario, itemId, corpo);
  }

  @Post('items/:itemId/normalization')
  @HttpCode(200)
  corrigir(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Usuario() usuario: number,
    @Body() corpo: Parameters<ReviewService['corrigir']>[2],
  ) {
    return this.revisao.corrigir(itemId, usuario, corpo);
  }

  @Post(':id/normalize')
  @HttpCode(200)
  retomar(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: number) {
    return this.receipts.retomar(id, usuario);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirmar(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: number) {
    return this.receipts.confirmar(id, usuario);
  }

  @Post('qr')
  importarPorQr(
    @Usuario() usuario: number,
    @Body() body: { url?: unknown; usar_ia?: unknown } | undefined,
  ) {
    const url = body?.url;
    if (typeof url !== 'string' || !url.trim() || url.length > URL_MAX) {
      throw new BadRequestException({ erro: 'url_invalida' });
    }
    return this.receipts.importarPorQr(url, usuario, usarIa(body?.usar_ia));
  }
}
