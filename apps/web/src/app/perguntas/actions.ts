"use server";

import { api, ErroApi } from "@/lib/api";

export interface Resultado {
  resposta: string;
  recusa: string | null;
  sql: string | null;
  colunas: string[];
  linhas: unknown[][];
}

export interface EstadoPergunta {
  pergunta?: string;
  erro?: string;
  resultado?: Resultado;
}

// Sem autenticação nesta etapa: a api valida a pergunta e o ai valida a consulta.
export async function perguntar(_: EstadoPergunta, form: FormData): Promise<EstadoPergunta> {
  const pergunta = String(form.get("pergunta") ?? "");
  try {
    return { pergunta, resultado: await api<Resultado>("/ask", "POST", { pergunta }) };
  } catch (erro) {
    if (erro instanceof ErroApi) return { pergunta, erro: erro.message };
    throw erro;
  }
}
