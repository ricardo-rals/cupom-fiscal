import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Usuario } from '../auth/auth.guard.js';
import { ForecastService } from './forecast.service.js';

@Controller()
export class ForecastController {
  constructor(private readonly previsao: ForecastService) {}

  @Get('products/:id/forecast')
  porProduto(
    @Param('id', ParseIntPipe) id: number,
    @Usuario() usuario: number,
  ) {
    return this.previsao.porProduto(id, usuario);
  }

  /** O job mensal faz o mesmo; isto serve para gerar na hora, como depois de carregar dados. */
  @Post('forecasts/run')
  @HttpCode(200)
  rodar(@Usuario() usuario: number) {
    return this.previsao.rodar(usuario);
  }
}
