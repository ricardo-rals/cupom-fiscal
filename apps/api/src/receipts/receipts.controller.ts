import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
const IMAGEM_MAX = 11_500_000; // base64 de 8 MB

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

  @Post('foto')
  importarPorFoto(
    @Usuario() usuario: number,
    @Body() corpo: { imagem?: unknown; usar_ia?: unknown } | undefined,
  ) {
    const imagem = corpo?.imagem;
    if (typeof imagem !== 'string' || !imagem || imagem.length > IMAGEM_MAX)
      throw new BadRequestException({ erro: 'imagem_invalida' });
    return this.receipts.importarPorFoto(
      usuario,
      imagem,
      usarIa(corpo?.usar_ia),
    );
  }

  @Post('manual')
  criarManual(
    @Usuario() usuario: number,
    @Body() corpo: Record<string, unknown> | undefined,
  ) {
    return this.receipts.criarManual(usuario, corpo, usarIa(corpo?.usar_ia));
  }

  @Post(':id/items')
  adicionarItem(
    @Param('id', ParseIntPipe) id: number,
    @Usuario() usuario: number,
    @Body() corpo: Record<string, unknown>,
  ) {
    return this.receipts.adicionarItem(id, usuario, corpo);
  }

  @Delete(':id/items/:itemId')
  excluirItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Usuario() usuario: number,
  ) {
    return this.receipts.excluirItem(id, usuario, itemId);
  }

  @Delete(':id')
  @HttpCode(204)
  excluir(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: number) {
    return this.receipts.excluir(id, usuario);
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
