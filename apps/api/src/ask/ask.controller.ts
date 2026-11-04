import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AskService } from './ask.service.js';

@Controller('ask')
export class AskController {
  constructor(private readonly agente: AskService) {}

  @Post()
  @HttpCode(200)
  perguntar(@Body() corpo: Parameters<AskService['perguntar']>[0]) {
    return this.agente.perguntar(corpo);
  }
}
