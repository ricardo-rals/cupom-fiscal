/** Cálculos de orçamento, previsão de gasto e lista de compras, sem banco: testáveis à parte. */

const UM_DIA_MS = 86_400_000;
export const COMPRAS_MIN = 3; // abaixo disso não há intervalo típico para confiar
const PERTO_DE_ACABAR = 0.8; // sugere quando passou 80% do intervalo típico
export const MESES_DA_MEDIA = 3;

export function mediana(valores: number[]) {
  const ordem = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordem.length / 2);
  return ordem.length % 2 ? ordem[meio] : (ordem[meio - 1] + ordem[meio]) / 2;
}

/** Alerta de orçamento: 80% avisa, 100% estourou. */
export function alerta(gasto: number, orcamento: number) {
  if (orcamento <= 0) return null;
  const fracao = gasto / orcamento;
  return fracao >= 1 ? 'estourou' : fracao >= 0.8 ? 'perto' : null;
}

/** "2026-11" → "2026-08", "2026-09", "2026-10": os meses fechados antes de `mes`. */
export function mesesAnteriores(mes: string, quantos: number) {
  const [ano, m] = mes.split('-').map(Number);
  return Array.from({ length: quantos }, (_, i) => {
    const data = new Date(Date.UTC(ano, m - 1 - quantos + i, 1));
    return data.toISOString().slice(0, 7);
  });
}

/** Média dos últimos meses fechados; mês sem compra conta como zero, não some da conta. */
export function mediaRecente(
  porMes: Map<string, number>,
  mesAtual: string,
  quantos = MESES_DA_MEDIA,
) {
  const meses = mesesAnteriores(mesAtual, quantos);
  return meses.reduce((soma, m) => soma + (porMes.get(m) ?? 0), 0) / quantos;
}

export interface Compra {
  produto: number;
  nome: string;
  marca: string;
  dia: string; // AAAA-MM-DD, no fuso do cupom
  quantidade: number;
  valor: number;
}

export interface Sugestao {
  produto: number;
  nome: string;
  marca: string;
  compras: number;
  intervalo_dias: number;
  dias_desde_a_ultima: number;
  ultima_compra: string;
  quantidade: number;
  preco_esperado: number;
  urgencia: number; // dias desde a última ÷ intervalo típico
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(ate) - Date.parse(de)) / UM_DIA_MS);

/**
 * Produto comprado em pelo menos 3 dias diferentes tem um intervalo típico (a mediana
 * entre compras). Entra na lista quando já passou 80% desse intervalo desde a última.
 */
export function listaDeCompras(compras: Compra[], hoje: string): Sugestao[] {
  const porProduto = new Map<number, Compra[]>();
  for (const compra of compras)
    porProduto.set(compra.produto, [
      ...(porProduto.get(compra.produto) ?? []),
      compra,
    ]);

  const sugestoes: Sugestao[] = [];
  for (const lista of porProduto.values()) {
    // Duas compras no mesmo dia são uma só ida ao mercado.
    const porDia = new Map<string, Compra>();
    for (const c of lista) {
      const dia = porDia.get(c.dia);
      porDia.set(
        c.dia,
        dia
          ? {
              ...dia,
              quantidade: dia.quantidade + c.quantidade,
              valor: dia.valor + c.valor,
            }
          : c,
      );
    }
    const dias = [...porDia.values()].sort((a, b) =>
      a.dia.localeCompare(b.dia),
    );
    if (dias.length < COMPRAS_MIN) continue;

    const intervalo = mediana(
      dias.slice(1).map((c, i) => diasEntre(dias[i].dia, c.dia)),
    );
    const ultima = dias.at(-1)!;
    const desde = diasEntre(ultima.dia, hoje);
    if (intervalo <= 0 || desde < PERTO_DE_ACABAR * intervalo) continue;

    const quantidade = mediana(dias.map((c) => c.quantidade));
    sugestoes.push({
      produto: ultima.produto,
      nome: ultima.nome,
      marca: ultima.marca,
      compras: dias.length,
      intervalo_dias: intervalo,
      dias_desde_a_ultima: desde,
      ultima_compra: ultima.dia,
      quantidade,
      // Preço da última compra: é o mais perto do que vai custar agora.
      preco_esperado:
        Math.round((ultima.valor / ultima.quantidade) * quantidade * 100) / 100,
      urgencia: Math.round((desde / intervalo) * 100) / 100,
    });
  }
  return sugestoes.sort((a, b) => b.urgencia - a.urgencia);
}
