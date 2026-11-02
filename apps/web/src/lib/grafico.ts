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
