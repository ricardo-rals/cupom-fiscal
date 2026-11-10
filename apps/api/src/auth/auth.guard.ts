import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DadosDoToken, verificarToken } from './token.js';

const PUBLICO = 'publico';
/** Rota sem login, como o health check. */
export const Publico = () => SetMetadata(PUBLICO, true);

type ComUsuario = Request & { usuarioId?: number };

/** Id do usuário da requisição; o guard global já garantiu que existe. */
export const Usuario = createParamDecorator(
  (_: unknown, contexto: ExecutionContext) =>
    contexto.switchToHttp().getRequest<ComUsuario>().usuarioId!,
);

const DONO = 1; // linha criada pela migration com os dados de antes do login

@Injectable()
export class AuthGuard implements CanActivate {
  // ponytail: cache sem limite; são poucos usuários. Trocar por LRU se passar de milhares.
  private readonly ids = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(contexto: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLICO, [
        contexto.getHandler(),
        contexto.getClass(),
      ])
    )
      return true;

    const requisicao = contexto.switchToHttp().getRequest<ComUsuario>();
    const segredo = process.env.API_TOKEN_SECRET;
    const [tipo, token] = (requisicao.headers.authorization ?? '').split(' ');
    const dados =
      segredo && tipo === 'Bearer' && token
        ? verificarToken(token, segredo)
        : null;
    if (!dados) throw new UnauthorizedException({ erro: 'nao_autenticado' });

    requisicao.usuarioId = await this.usuario(dados);
    return true;
  }

  private async usuario(dados: DadosDoToken) {
    const conhecido = this.ids.get(dados.sub);
    if (conhecido) return conhecido;

    const email = dados.email?.toLowerCase() ?? null;
    const nome = dados.nome ?? '';
    let id = (
      await this.prisma.user.findUnique({ where: { google_id: dados.sub } })
    )?.id;

    // Primeiro login do dono: assume os dados que existiam antes do login.
    if (!id && email && email === process.env.OWNER_EMAIL?.toLowerCase()) {
      const { count } = await this.prisma.user.updateMany({
        where: { id: DONO, google_id: null },
        data: { google_id: dados.sub, email, nome },
      });
      if (count) id = DONO;
    }

    if (!id) {
      try {
        id = (
          await this.prisma.user.create({
            data: { google_id: dados.sub, email, nome },
          })
        ).id;
      } catch (erro) {
        // Duas requisições do primeiro login ao mesmo tempo: a outra criou.
        if (
          !(erro instanceof Prisma.PrismaClientKnownRequestError) ||
          erro.code !== 'P2002'
        )
          throw erro;
        id = (
          await this.prisma.user.findUniqueOrThrow({
            where: { google_id: dados.sub },
          })
        ).id;
      }
    }
    this.ids.set(dados.sub, id);
    return id;
  }
}
