import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Usuario } from '../auth/auth.guard.js';
import { DashboardService } from './dashboard.service.js';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/summary')
  resumo(
    @Query() filtros: Parameters<DashboardService['resumo']>[0],
    @Usuario() usuario: number,
  ) {
    return this.dashboard.resumo(filtros, usuario);
  }

  @Get('products/:id/prices')
  precos(@Param('id', ParseIntPipe) id: number, @Usuario() usuario: number) {
    return this.dashboard.precos(id, usuario);
  }
}
