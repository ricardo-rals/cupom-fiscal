import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { limiteDeGastoAtingido } from '../normalization/normalization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Chamada {
  modelo: string;
  tokens_in: number;
  tokens_out: number;
  custo: string;
  latencia_ms: number;
}

interface RespostaAgente {
  resposta: string;
  recusa: string | null;
  sql: string | null;
  colunas: string[];
  linhas: unknown[][];
  chamadas: Chamada[];
  prompt_version: string;
}

const PERGUNTA_MAX = 500;
const TIMEOUT_AI_MS = 120_000; // até 3 chamadas ao LLM e a consulta
const FINALIDADE = 'agente';

@Injectable()
export class AskService implements OnModuleInit {
  private readonly logger = new Logger(AskService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A migration cria agent_ro sem login; a senha vem do ambiente, nunca do repositório. */
  async onModuleInit() {
    const senha = process.env.AGENT_RO_PASSWORD;
    if (!senha) return;
    const [{ literal }] = await this.prisma.$queryRaw<{ literal: string }[]>`
      SELECT quote_literal(${senha}) AS literal`;
    await this.prisma.$executeRawUnsafe(
      `ALTER ROLE agent_ro LOGIN PASSWORD ${literal}`,
    );
    this.logger.log('login do agent_ro habilitado');
  }

  async perguntar(corpo: { pergunta?: unknown } | undefined, usuario: number) {
    const pergunta = corpo?.pergunta;
    if (
      typeof pergunta !== 'string' ||
      !pergunta.trim() ||
      pergunta.length > PERGUNTA_MAX
    ) {
      throw new BadRequestException({ erro: 'pergunta_invalida' });
    }
    if (await limiteDeGastoAtingido(this.prisma, usuario)) {
      throw new HttpException({ erro: 'limite_de_gasto' }, 429);
    }

    let resposta: Response;
    try {
      resposta = await fetch(`${process.env.AI_URL}/agent/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: pergunta.trim(), user_id: usuario }),
        signal: AbortSignal.timeout(TIMEOUT_AI_MS),
      });
    } catch {
      throw new ServiceUnavailableException({ erro: 'ai_indisponivel' });
    }
    if (resposta.status === 503) {
      const { detail } = (await resposta.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new ServiceUnavailableException({
        erro: detail ?? 'agente_nao_configurado',
      });
    }
    if (!resposta.ok)
      throw new ServiceUnavailableException({ erro: 'llm_indisponivel' });

    const { chamadas, ...resultado } =
      (await resposta.json()) as RespostaAgente;
    // Recusa também custa: o limite mensal conta todas as chamadas.
    await this.prisma.llmCall.createMany({
      data: chamadas.map((c) => ({
        user_id: usuario,
        finalidade: FINALIDADE,
        ...c,
      })),
    });
    return resultado;
  }
}
