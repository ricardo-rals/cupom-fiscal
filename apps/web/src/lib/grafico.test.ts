import { expect, test } from "vitest";
import {
  agruparPorPeriodo,
  ALTURA,
  escalaDaSerie,
  hojeNaBahia,
  LARGURA,
  periodoPadrao,
  topoDoEixo,
} from "./grafico";

test("o dia vem do fuso da Bahia, não de UTC", () => {
  expect(hojeNaBahia(new Date("2026-11-02T02:00:00Z"))).toBe("2026-11-01");
});

test("período padrão tem 90 dias contando hoje", () => {
  expect(periodoPadrao(new Date("2026-03-31T15:00:00Z"))).toEqual({
    from: "2026-01-01",
    to: "2026-03-31",
  });
});

test("a série cabe no gráfico, e o preço maior fica mais alto", () => {
  const e = escalaDaSerie([
    { instante: 0, valor: 10 },
    { instante: 100, valor: 20 },
  ]);
  expect(e.x(0)).toBeLessThan(e.x(100));
  expect(e.y(20)).toBeLessThan(e.y(10));
  for (const valor of [10, 20]) {
    expect(e.y(valor)).toBeGreaterThan(0);
    expect(e.y(valor)).toBeLessThan(ALTURA);
  }
  expect(e.x(100)).toBeLessThan(LARGURA);
});

test("um único ponto fica centralizado e sem divisão por zero", () => {
  const e = escalaDaSerie([{ instante: 5, valor: 10 }]);
  expect(Number.isFinite(e.x(5))).toBe(true);
  expect(Number.isFinite(e.y(10))).toBe(true);
});

test("período curto agrupa por dia e preenche os dias sem compra com zero", () => {
  const { granularidade, grupos } = agruparPorPeriodo(
    [
      { dia: "2026-03-01", total: "10" },
      { dia: "2026-03-03", total: 5 },
    ],
    "2026-03-01",
    "2026-03-03",
  );
  expect(granularidade).toBe("dia");
  expect(grupos).toEqual([
    { inicio: "2026-03-01", total: 10 },
    { inicio: "2026-03-02", total: 0 },
    { inicio: "2026-03-03", total: 5 },
  ]);
});

test("90 dias agrupa por semana começando na segunda; um ano, por mês", () => {
  const semanas = agruparPorPeriodo(
    [
      { dia: "2026-01-04", total: 3 }, // domingo: semana de 29/12
      { dia: "2026-01-05", total: 4 }, // segunda
      { dia: "2026-01-11", total: 1 },
    ],
    "2026-01-01",
    "2026-03-31",
  );
  expect(semanas.granularidade).toBe("semana");
  expect(semanas.grupos.slice(0, 2)).toEqual([
    { inicio: "2025-12-29", total: 3 },
    { inicio: "2026-01-05", total: 5 },
  ]);
  const meses = agruparPorPeriodo([{ dia: "2026-02-10", total: 7 }], "2026-01-15", "2026-12-31");
  expect(meses.granularidade).toBe("mes");
  expect(meses.grupos).toHaveLength(12);
  expect(meses.grupos[1]).toEqual({ inicio: "2026-02-01", total: 7 });
});

test("topo do eixo é um número redondo", () => {
  expect(topoDoEixo(0)).toBe(1);
  expect(topoDoEixo(83)).toBe(100);
  expect(topoDoEixo(230)).toBe(250);
  expect(topoDoEixo(1400)).toBe(2000);
});
