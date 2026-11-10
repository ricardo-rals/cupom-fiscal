import { Test, TestingModule } from '@nestjs/testing';
import pg from 'pg';
import { AppModule } from './../src/app.module.js';
import { NormalizationService } from './../src/normalization/normalization.service.js';

const CNPJ = '00000000000272';
const PREFIXO = 'TESTE-NORMALIZACAO';
const MARCADOR_PRODUTO = 'teste normalizacao';

interface ItemEnviado {
  id: number;
  descricao: string;
}
interface CorpoEnviado {
  itens: ItemEnviado[];
  correcoes: { descricao_original: string }[];
}

const chamada = {
  modelo: 'gemini-3.6-flash',
  tokens_in: 1000,
  tokens_out: 200,
  custo: '0.000200',
  latencia_ms: 50,
};

const normalizado = (id: number, campos: object = {}) => ({
  id,
  produto: `${MARCADOR_PRODUTO} Açaí  Orgânico`,
  marca: 'Marca Ótima',
  conteudo: 0.2,
  unidade_padrao: 'kg',
  categoria: 'Frutas',
  confianca: 0.95,
  ...campos,
});

describe('normalização de um cupom', () => {
  let modulo: TestingModule;
  let servico: NormalizationService;
  let db: pg.Client;
  let chaveSeq = 0;

  const criarCupom = async (descricoes: string[]) => {
    const { rows: lojas } = await db.query<{ id: number }>(
      `INSERT INTO stores (user_id, cnpj, nome) VALUES (1, $1, 'LOJA') ON CONFLICT (user_id, cnpj)
       DO UPDATE SET nome = 'LOJA' RETURNING id`,
      [CNPJ],
    );
    chaveSeq += 1;
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
       VALUES (1, $1, $2, now(), 10, 'qr', 'confirmado') RETURNING id`,
      [lojas[0].id, `28${String(chaveSeq).padStart(42, '0')}`],
    );
    const ids: number[] = [];
    for (const descricao of descricoes) {
      const item = await db.query<{ id: number }>(
        `INSERT INTO receipt_items
           (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
         VALUES ($1, $2, 2, 'UN', 5, 10) RETURNING id`,
        [rows[0].id, descricao],
      );
      ids.push(item.rows[0].id);
    }
    return { receiptId: rows[0].id, ids };
  };

  const iaResponde = (
    montar: (corpo: CorpoEnviado, url: string) => { status?: number; corpo?: unknown },
  ) => {
    const chamadas: (CorpoEnviado & { url: string })[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        const corpo = JSON.parse(init.body) as CorpoEnviado;
        chamadas.push({ ...corpo, url });
        const { status = 200, corpo: resposta = {} } = montar(corpo, url);
        return Response.json(resposta, { status });
      }),
    );
    return chamadas;
  };

  const iaResolveTudo = (campos: object = {}) =>
    iaResponde(({ itens }) => ({
      corpo: {
        itens: itens.map((i) => normalizado(i.id, campos)),
        chamada,
        prompt_version: 'v1',
      },
    }));

  const normalizacao = async (id: number) => {
    const { rows } = await db.query<{
      product_id: number | null;
      origem: string;
      em_revisao: boolean;
      prompt_version: string | null;
      llm_call_id: number | null;
    }>(
      `SELECT product_id, origem, em_revisao, prompt_version, llm_call_id
       FROM item_normalizations WHERE receipt_item_id = $1`,
      [id],
    );
    return rows[0];
  };

  const limpar = async () => {
    await db.query('DELETE FROM user_labels WHERE descricao_original LIKE $1', [`${PREFIXO}%`]);
    await db.query('DELETE FROM normalization_cache WHERE cnpj = $1', [CNPJ]);
    await db.query(
      `DELETE FROM receipts WHERE store_id IN (SELECT id FROM stores WHERE cnpj = $1)`,
      [CNPJ],
    );
    await db.query('DELETE FROM stores WHERE cnpj = $1', [CNPJ]);
    await db.query('DELETE FROM products WHERE nome_canonico LIKE $1', [`${MARCADOR_PRODUTO}%`]);
    await db.query(`DELETE FROM llm_calls WHERE modelo = 'gemini-3.6-flash'`);
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    // As views só mostram o usuário declarado na sessão, como o agente faz.
    await db.query("SELECT set_config('app.user_id', '1', false)");
    modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    servico = modulo.get(NormalizationService);
  });

  beforeEach(async () => {
    process.env.AI_URL = 'http://ai-teste';
    delete process.env.LLM_LIMITE_MENSAL_USD;
    delete process.env.NORMALIZACAO_LIMIAR;
    await limpar();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await limpar();
    await db.end();
    await modulo.close();
  });

  it('grava produto canônico, chamada e cache, e marca o cupom como normalizado', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} A`]);
    iaResolveTudo();

    await servico.normalizarCupom(receiptId);

    const item = await normalizacao(ids[0]);
    expect(item).toMatchObject({ origem: 'llm', em_revisao: false, prompt_version: 'v1' });
    expect(item.llm_call_id).not.toBeNull();

    const { rows: produtos } = await db.query(
      'SELECT nome_canonico, marca, conteudo::text, unidade_padrao::text FROM products WHERE id = $1',
      [item.product_id],
    );
    expect(produtos).toEqual([
      {
        nome_canonico: `${MARCADOR_PRODUTO} acai organico`,
        marca: 'marca otima',
        conteudo: '0.2000',
        unidade_padrao: 'kg',
      },
    ]);

    const { rows: cupons } = await db.query('SELECT status FROM receipts WHERE id = $1', [
      receiptId,
    ]);
    expect(cupons[0].status).toBe('normalizado');
    const { rows: views } = await db.query(
      `SELECT preco_unidade_padrao::text FROM v_compras WHERE produto LIKE $1`,
      [`${MARCADOR_PRODUTO}%`],
    );
    expect(views).toEqual([{ preco_unidade_padrao: '25.0000' }]); // R$ 5 por 0,2 kg
  });

  it('divide em lotes de 20 itens e reaproveita o mesmo produto', async () => {
    const descricoes = Array.from({ length: 45 }, (_, i) => `${PREFIXO} LOTE ${i}`);
    const { receiptId, ids } = await criarCupom(descricoes);
    const chamadas = iaResolveTudo();

    await servico.normalizarCupom(receiptId);

    expect(chamadas.map((c) => c.itens.length)).toEqual([20, 20, 5]);
    const { rows } = await db.query(
      'SELECT count(DISTINCT product_id)::int AS n FROM item_normalizations WHERE receipt_item_id = ANY($1)',
      [ids],
    );
    expect(rows[0].n).toBe(1);
  });

  it('segunda compra do mesmo item usa o cache, sem chamar o LLM', async () => {
    const primeiro = await criarCupom([`${PREFIXO} CACHE`]);
    iaResolveTudo();
    await servico.normalizarCupom(primeiro.receiptId);

    const segundo = await criarCupom([`${PREFIXO} CACHE`]);
    const chamadas = iaResolveTudo();
    await servico.normalizarCupom(segundo.receiptId);

    expect(chamadas).toHaveLength(0);
    expect((await normalizacao(segundo.ids[0])).origem).toBe('cache');
  });

  it('correção do usuário vence o cache e vai como exemplo para outros itens', async () => {
    const primeiro = await criarCupom([`${PREFIXO} ROTULO`]);
    iaResolveTudo();
    await servico.normalizarCupom(primeiro.receiptId);
    const { product_id: produto } = await normalizacao(primeiro.ids[0]);
    const { rows: cat } = await db.query<{ id: number }>(
      `SELECT id FROM categories WHERE nome = 'Frutas'`,
    );
    await db.query(
      'INSERT INTO user_labels (user_id, descricao_original, product_id, category_id) VALUES (1, $1, $2, $3)',
      [`${PREFIXO} ROTULO`, produto, cat[0].id],
    );

    const segundo = await criarCupom([`${PREFIXO} ROTULO`, `${PREFIXO} NOVO`]);
    const chamadas = iaResolveTudo();
    await servico.normalizarCupom(segundo.receiptId);

    expect((await normalizacao(segundo.ids[0])).origem).toBe('usuario');
    expect(chamadas[0].itens.map((i) => i.descricao)).toEqual([`${PREFIXO} NOVO`]);
    expect(chamadas[0].correcoes.map((c) => c.descricao_original)).toContain(`${PREFIXO} ROTULO`);
  });

  it('baixa confiança vai para revisão, fora das views e do cache', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} DUVIDA`]);
    iaResolveTudo({ confianca: 0.5 });

    await servico.normalizarCupom(receiptId);

    const item = await normalizacao(ids[0]);
    expect(item.em_revisao).toBe(true);
    expect(item.product_id).not.toBeNull(); // sugestão para a tela de revisão
    const { rows: cache } = await db.query(
      'SELECT 1 FROM normalization_cache WHERE descricao_original = $1',
      [`${PREFIXO} DUVIDA`],
    );
    expect(cache).toEqual([]);
    const { rows: views } = await db.query('SELECT 1 FROM v_compras WHERE produto LIKE $1', [
      `${MARCADOR_PRODUTO}%`,
    ]);
    expect(views).toEqual([]);
  });

  it('o limiar é configurável', async () => {
    process.env.NORMALIZACAO_LIMIAR = '0.4';
    const { receiptId, ids } = await criarCupom([`${PREFIXO} LIMIAR`]);
    iaResolveTudo({ confianca: 0.5 });
    await servico.normalizarCupom(receiptId);
    expect((await normalizacao(ids[0])).em_revisao).toBe(false);
  });

  it('todas as tentativas falharam: registra o custo e manda para revisão', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} FALHA`]);
    iaResponde(() => ({ corpo: { itens: [], chamada, prompt_version: 'v1' } }));

    await servico.normalizarCupom(receiptId);

    const item = await normalizacao(ids[0]);
    expect(item).toMatchObject({ em_revisao: true, product_id: null });
    expect(item.llm_call_id).not.toBeNull();
  });

  // O modelo local responde com confiança 0,3: abaixo do limiar de 0,5, vai para revisão.
  const localResponde = (confianca = 0.3) =>
    iaResponde((corpo, url) =>
      url.endsWith('/normalize/local')
        ? { corpo: { itens: corpo.itens.map((i) => normalizado(i.id, { confianca })) } }
        : { status: 503 },
    );

  it('cupom excluído antes do job: termina sem erro e sem nova tentativa', async () => {
    const { receiptId } = await criarCupom([`${PREFIXO} EXCLUIDO`]);
    await db.query('DELETE FROM receipts WHERE id = $1', [receiptId]);
    await expect(servico.normalizarCupom(receiptId)).resolves.toBeUndefined();
  });

  it('sem chave de API: o modelo local sugere e o item vai para revisão', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} SEM CHAVE`]);
    const chamadas = localResponde();

    await servico.normalizarCupom(receiptId);

    expect(chamadas.map((c) => c.url)).toEqual([
      'http://ai-teste/normalize/batch',
      'http://ai-teste/normalize/local',
    ]);
    const resultado = await normalizacao(ids[0]);
    expect(resultado).toMatchObject({ em_revisao: true, origem: 'local', llm_call_id: null });
    expect(resultado.product_id).not.toBeNull(); // a sugestão aparece na revisão
  });

  it('cupom sem IA: não chama o LLM e o resultado confiante não entra no cache', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} SEM IA`]);
    await db.query('UPDATE receipts SET usar_ia = false WHERE id = $1', [receiptId]);
    const chamadas = localResponde(0.7);

    await servico.normalizarCupom(receiptId);

    expect(chamadas.map((c) => c.url)).toEqual(['http://ai-teste/normalize/local']);
    expect(await normalizacao(ids[0])).toMatchObject({ em_revisao: false, origem: 'local' });
    const { rows } = await db.query('SELECT 1 FROM normalization_cache WHERE cnpj = $1', [CNPJ]);
    expect(rows).toHaveLength(0);
  });

  it('limite mensal atingido: não chama o LLM e manda para revisão', async () => {
    await db.query(
      `INSERT INTO llm_calls (user_id, finalidade, modelo, tokens_in, tokens_out, custo, latencia_ms)
       VALUES (1, 'normalizacao', 'gemini-3.6-flash', 1, 1, 6, 1)`,
    );
    const { receiptId, ids } = await criarCupom([`${PREFIXO} LIMITE`]);
    const chamadas = localResponde();

    await servico.normalizarCupom(receiptId);

    expect(chamadas.map((c) => c.url)).toEqual(['http://ai-teste/normalize/local']);
    expect(await normalizacao(ids[0])).toMatchObject({ em_revisao: true, origem: 'local' });
  });

  it('LLM fora do ar: falha, não marca o cupom e dá para repetir depois', async () => {
    const { receiptId, ids } = await criarCupom([`${PREFIXO} FORA`]);
    iaResponde(() => ({ status: 502 }));

    await expect(servico.normalizarCupom(receiptId)).rejects.toThrow();
    const { rows } = await db.query('SELECT status FROM receipts WHERE id = $1', [receiptId]);
    expect(rows[0].status).toBe('confirmado');
    expect(await normalizacao(ids[0])).toBeUndefined();

    iaResolveTudo();
    await servico.normalizarCupom(receiptId);
    expect((await normalizacao(ids[0])).origem).toBe('llm');
  });
});
