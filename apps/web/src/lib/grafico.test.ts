import { expect, test } from "vitest";
import { ALTURA, escalaDaSerie, hojeNaBahia, LARGURA, periodoPadrao } from "./grafico";

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
