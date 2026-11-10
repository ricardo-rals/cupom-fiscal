import {
  alerta,
  Compra,
  listaDeCompras,
  mediaRecente,
  mediana,
  mesesAnteriores,
} from './calculos.js';

const compra = (
  produto: number,
  dia: string,
  quantidade = 1,
  valor = 10,
): Compra => ({
  produto,
  nome: `produto ${produto}`,
  marca: '',
  dia,
  quantidade,
  valor,
});

describe('cálculos de gastos', () => {
  it('mediana com quantidade par e ímpar', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
  });

  it('alerta de orçamento em 80% e 100%', () => {
    expect(alerta(79, 100)).toBeNull();
    expect(alerta(80, 100)).toBe('perto');
    expect(alerta(100, 100)).toBe('estourou');
    expect(alerta(50, 0)).toBeNull();
  });

  it('meses anteriores atravessam a virada do ano', () => {
    expect(mesesAnteriores('2026-02', 3)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });

  it('média recente conta mês sem compra como zero', () => {
    const porMes = new Map([
      ['2026-08', 300],
      ['2026-10', 300],
    ]);
    expect(mediaRecente(porMes, '2026-11')).toBe(200);
  });

  it('sugere o recorrente perto de acabar e ignora o resto', () => {
    const compras = [
      // café a cada 10 dias; última há 9 dias: entra
      compra(1, '2026-10-01', 1, 18),
      compra(1, '2026-10-11', 1, 18),
      compra(1, '2026-10-21', 2, 40),
      // arroz a cada 30 dias; última há 9 dias: ainda não
      compra(2, '2026-08-01'),
      compra(2, '2026-08-31'),
      compra(2, '2026-10-21'),
      // compra única: nunca
      compra(3, '2026-10-01'),
      // duas compras no mesmo dia contam como uma: só 2 dias, fica de fora
      compra(4, '2026-10-01'),
      compra(4, '2026-10-01'),
      compra(4, '2026-10-20'),
    ];
    const lista = listaDeCompras(compras, '2026-10-30');
    expect(lista.map((s) => s.produto)).toEqual([1]);
    expect(lista[0]).toMatchObject({
      intervalo_dias: 10,
      dias_desde_a_ultima: 9,
      quantidade: 1,
      preco_esperado: 20, // 40 ÷ 2 da última compra, vezes a quantidade de sempre
      urgencia: 0.9,
    });
  });
});
