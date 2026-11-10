export const LARGURA = 640;
export const ALTURA = 240;
const MARGEM = { topo: 16, direita: 16, base: 28, esquerda: 64 };

export const hojeNaBahia = (agora = new Date()) =>
  new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

export function periodoPadrao(agora = new Date()) {
  const to = hojeNaBahia(agora);
  const inicio = new Date(`${to}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - 89);
  return { from: inicio.toISOString().slice(0, 10), to };
}

/** Escala da série. Eixo sem zero de propósito: o que importa é a variação do preço. */
export function escalaDaSerie(pontos: { instante: number; valor: number }[]) {
  const valores = pontos.map((p) => p.valor);
  const instantes = pontos.map((p) => p.instante);
  const folga = (Math.max(...valores) - Math.min(...valores)) * 0.1 || Math.max(...valores) * 0.1 || 1;
  const minimo = Math.max(0, Math.min(...valores) - folga);
  const maximo = Math.max(...valores) + folga;
  const inicio = Math.min(...instantes);
  const duracao = Math.max(...instantes) - inicio;
  const largura = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const altura = ALTURA - MARGEM.topo - MARGEM.base;

  const y = (valor: number) => MARGEM.topo + (1 - (valor - minimo) / (maximo - minimo)) * altura;
  return {
    x: (instante: number) =>
      MARGEM.esquerda + (duracao === 0 ? largura / 2 : ((instante - inicio) / duracao) * largura),
    y,
    marcas: [minimo, (minimo + maximo) / 2, maximo].map((valor) => ({ valor, y: y(valor) })),
    esquerda: MARGEM.esquerda,
    direita: LARGURA - MARGEM.direita,
    base: ALTURA - MARGEM.base,
  };
}

const DIA_MS = 86_400_000;
const somaDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

export type Granularidade = "dia" | "semana" | "mes";

/**
 * Agrupa o gasto diário em dia (até 45 dias), semana (até 200) ou mês, preenchendo
 * com zero os períodos sem compra: um buraco no eixo também é informação.
 */
export function agruparPorPeriodo(
  porDia: { dia: string; total: string | number }[],
  from: string,
  to: string,
) {
  const dias = Math.round((Date.parse(to) - Date.parse(from)) / DIA_MS) + 1;
  const granularidade: Granularidade = dias <= 45 ? "dia" : dias <= 200 ? "semana" : "mes";
  const inicioDe = (dia: string) => {
    if (granularidade === "dia") return dia;
    if (granularidade === "mes") return `${dia.slice(0, 7)}-01`;
    const semana = (new Date(`${dia}T00:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
    return somaDias(dia, -semana);
  };
  const proximo = (inicio: string) => {
    if (granularidade === "dia") return somaDias(inicio, 1);
    if (granularidade === "semana") return somaDias(inicio, 7);
    const d = new Date(`${inicio}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  };
  const totais = new Map<string, number>();
  for (const { dia, total } of porDia) {
    const chave = inicioDe(dia);
    totais.set(chave, (totais.get(chave) ?? 0) + Number(total));
  }
  const grupos: { inicio: string; total: number }[] = [];
  for (let inicio = inicioDe(from); inicio <= to; inicio = proximo(inicio)) {
    grupos.push({ inicio, total: totais.get(inicio) ?? 0 });
  }
  return { granularidade, grupos };
}

/** Topo do eixo arredondado para 1, 2, 2.5 ou 5 vezes uma potência de 10. */
export function topoDoEixo(maior: number) {
  if (maior <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(maior));
  return ([1, 2, 2.5, 5, 10].find((f) => f * potencia >= maior) ?? 10) * potencia;
}
