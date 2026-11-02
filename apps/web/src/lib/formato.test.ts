import { expect, test } from "vitest";
import { dataCurta, dataHora, decimal, deCampoData, moeda, paraCampoData } from "./formato";

test.each([
  ["39,90", "39.90"],
  ["1.234,56", "1234.56"],
  ["39.90", "39.90"],
  ["0.322", "0.322"],
  [" 2 ", "2"],
])("decimal(%s)", (entrada, saida) => {
  expect(decimal(entrada)).toBe(saida);
});

test("moeda e data em português, no fuso do cupom", () => {
  expect(moeda("12.5").replace(/\s/g, " ")).toBe("R$ 12,50");
  expect(dataHora("2026-10-26T17:31:57Z")).toBe("26/10/2026, 14:31");
});

test("campo de data ida e volta mantém o instante", () => {
  const iso = "2026-10-26T17:31:57.000Z";
  expect(paraCampoData(iso)).toBe("2026-10-26T14:31:57");
  expect(new Date(deCampoData(paraCampoData(iso))).toISOString()).toBe(iso);
  expect(deCampoData("2026-10-26T14:31")).toBe("2026-10-26T14:31:00-03:00");
});

test("data curta aceita dia e instante, sempre no fuso do cupom", () => {
  expect(dataCurta("2026-10-26")).toBe("26/10/2026");
  expect(dataCurta("2026-10-27T01:00:00Z")).toBe("26/10/2026");
});
