"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ErroApi } from "@/lib/api";
import { decimal, deCampoData } from "@/lib/formato";

export interface Estado {
  erro?: string;
  aviso?: string;
}

const campo = (form: FormData, nome: string) => String(form.get(nome) ?? "");

async function executar(chamada: () => Promise<unknown>, aviso: string): Promise<Estado> {
  try {
    await chamada();
  } catch (erro) {
    if (erro instanceof ErroApi) return { erro: erro.message };
    throw erro;
  }
  revalidatePath("/", "layout");
  return { aviso };
}

const normalizacao = (form: FormData) => ({
  produto: campo(form, "produto"),
  marca: campo(form, "marca"),
  conteudo: Number(decimal(campo(form, "conteudo"))),
  unidade_padrao: campo(form, "unidade_padrao"),
  categoria: campo(form, "categoria"),
});

// A validação de cada campo fica na api.
export async function importar(_: Estado, form: FormData): Promise<Estado> {
  let id: unknown;
  try {
    ({ id } = await api<{ id: number }>("/receipts/qr", "POST", {
      url: campo(form, "url"),
      usar_ia: form.get("usar_ia") === "on",
    }));
  } catch (erro) {
    if (!(erro instanceof ErroApi)) throw erro;
    if (erro.codigo !== "cupom_ja_importado") return { erro: erro.message };
    id = erro.corpo.receipt_id; // já importado: o usuário vê o cupom e o aviso fica na lista
  }
  revalidatePath("/", "layout");
  redirect(`/cupons/${id}`);
}

export async function salvarCupom(id: number, _: Estado, form: FormData) {
  return executar(
    () =>
      api(`/receipts/${id}`, "PATCH", {
        mercado: campo(form, "mercado"),
        emitido_em: deCampoData(campo(form, "emitido_em")),
        total: decimal(campo(form, "total")),
        desconto: decimal(campo(form, "desconto")),
        acrescimo: decimal(campo(form, "acrescimo")),
        pagamento: campo(form, "pagamento"),
      }),
    "Cupom salvo.",
  );
}

export async function salvarItem(id: number, itemId: number, _: Estado, form: FormData) {
  return executar(
    () =>
      api(`/receipts/${id}/items/${itemId}`, "PATCH", {
        codigo: campo(form, "codigo"),
        descricao_original: campo(form, "descricao_original"),
        quantidade: decimal(campo(form, "quantidade")),
        unidade: campo(form, "unidade"),
        valor_unitario: decimal(campo(form, "valor_unitario")),
        valor_total: decimal(campo(form, "valor_total")),
      }),
    "Item salvo.",
  );
}

export async function corrigirItem(itemId: number, _: Estado, form: FormData) {
  return executar(
    () => api(`/receipts/items/${itemId}/normalization`, "POST", normalizacao(form)),
    "Correção salva.",
  );
}

export async function resolverRevisao(itemId: number, _: Estado, form: FormData) {
  return executar(
    () => api(`/review-queue/${itemId}/resolve`, "POST", normalizacao(form)),
    "Correção salva.",
  );
}

export async function retomar(id: number) {
  return executar(() => api(`/receipts/${id}/normalize`, "POST"), "Normalização retomada.");
}
