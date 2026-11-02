const FUSO = "America/Bahia"; // sem horário de verão: sempre -03:00

/** Aceita "1.234,56" e "39.90"; ponto sem vírgula continua sendo decimal, como em "0.322". */
export const decimal = (texto: string) => {
  const limpo = texto.trim();
  return limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
};

export const moeda = (valor: string | number) =>
  Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: FUSO,
    dateStyle: "short",
    timeStyle: "short",
  });

export const dataCurta = (data: string) =>
  new Date(data.length === 10 ? `${data}T12:00:00-03:00` : data).toLocaleDateString("pt-BR", {
    timeZone: FUSO,
  });

/** Valor de um `<input type="datetime-local">`, no fuso do cupom. */
export const paraCampoData = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);

export const deCampoData = (campo: string) =>
  `${campo.length === 16 ? `${campo}:00` : campo}-03:00`;
