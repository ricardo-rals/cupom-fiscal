import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ReceiptsService } from './receipts.service.js';

const URL_MAX = 2048;

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get(':id')
  situacao(@Param('id', ParseIntPipe) id: number) {
    return this.receipts.situacao(id);
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
