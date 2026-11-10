import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { Publico, Usuario } from './auth/auth.guard.js';
import { PrismaService } from './prisma/prisma.service.js';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Publico()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('me')
  async eu(@Usuario() usuario: number) {
    const { id, email, nome, usar_ia } =
      await this.prisma.user.findUniqueOrThrow({ where: { id: usuario } });
    return { id, email, nome, usar_ia };
  }

  /** Preferência de IA: o padrão de cada importação, que pode ser trocado na hora. */
  @Patch('me')
  async preferencias(
    @Usuario() usuario: number,
    @Body() corpo: { usar_ia?: unknown } | undefined,
  ) {
    if (typeof corpo?.usar_ia !== 'boolean')
      throw new BadRequestException({
        erro: 'campo_invalido',
        campo: 'usar_ia',
      });
    await this.prisma.user.update({
      where: { id: usuario },
      data: { usar_ia: corpo.usar_ia },
    });
    return this.eu(usuario);
  }
}
