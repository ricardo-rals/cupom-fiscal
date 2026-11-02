import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/summary')
  resumo(@Query() filtros: Parameters<DashboardService['resumo']>[0]) {
    return this.dashboard.resumo(filtros);
  }

  @Get('products/:id/prices')
  precos(@Param('id', ParseIntPipe) id: number) {
    return this.dashboard.precos(id);
  }
}
