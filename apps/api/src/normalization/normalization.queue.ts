import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { PrismaService } from '../prisma/prisma.service.js';
import { NormalizationService } from './normalization.service.js';

const FILA = 'normalizacao';
const TENTATIVAS = 5;

@Injectable()
export class NormalizationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NormalizationQueue.name);
  private readonly boss = new PgBoss(process.env.DATABASE_URL ?? '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizacao: NormalizationService,
  ) {}

  async onModuleInit() {
    this.boss.on('error', (erro) => this.logger.error(erro.message));
    await this.boss.start();
    await this.boss.createQueue(FILA);
    if (process.env.NORMALIZACAO_WORKER === 'off') return;

    await this.boss.work<{ receiptId: number }>(
      FILA,
      { pollingIntervalSeconds: 1 },
      async ([job]) => this.normalizacao.normalizarCupom(job.data.receiptId),
    );

    // Recupera o que parou no caminho: job perdido ou tentativas esgotadas, como na falta de crédito.
    const pendentes = await this.prisma.receipt.findMany({
      where: { status: 'confirmado' },
      select: { id: true },
    });
    await Promise.all(pendentes.map(({ id }) => this.enfileirar(id)));
  }

  onModuleDestroy() {
    return this.boss.stop({ graceful: true, timeout: 5_000 });
  }

  /** Sem job vivo e ainda `confirmado`, o cupom parou: tentativas esgotadas ou job perdido. */
  async emAndamento(receiptId: number) {
    const jobs = await this.prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM pgboss.job
      WHERE name = ${FILA}
        AND state IN ('created', 'retry', 'active')
        AND data->>'receiptId' = ${String(receiptId)}
      LIMIT 1`;
    return jobs.length > 0;
  }

  /** Uma falha aqui não perde o cupom: ele segue `confirmado` e volta na próxima subida. */
  async enfileirar(receiptId: number) {
    try {
      await this.boss.send(
        FILA,
        { receiptId },
        {
          retryLimit: TENTATIVAS,
          retryBackoff: true,
          retryDelay: Number(process.env.NORMALIZACAO_RETRY_DELAY_S ?? 30),
          expireInSeconds: 900,
        },
      );
    } catch (erro) {
      this.logger.error(
        `cupom ${receiptId} fora da fila: ${(erro as Error).message}`,
      );
    }
  }
}
