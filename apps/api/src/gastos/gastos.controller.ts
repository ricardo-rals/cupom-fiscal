import { Body, Controller, Get, Put } from '@nestjs/common';
import { Usuario } from '../auth/auth.guard.js';
import { GastosService } from './gastos.service.js';

@Controller()
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

  @Get('budgets')
  orcamentos(@Usuario() usuario: number) {
    return this.gastos.orcamentos(usuario);
  }

  @Put('budgets')
  definirOrcamento(
    @Usuario() usuario: number,
    @Body() corpo: Parameters<GastosService['definirOrcamento']>[1],
  ) {
    return this.gastos.definirOrcamento(usuario, corpo);
  }

  @Get('spending/forecast')
  previsao(@Usuario() usuario: number) {
    return this.gastos.previsao(usuario);
  }

  @Get('shopping-list')
  listaDeCompras(@Usuario() usuario: number) {
    return this.gastos.listaDeCompras(usuario);
  }
}
