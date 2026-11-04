const MENSAGENS: Record<string, string> = {
  url_invalida: "Cole a URL do QR code do cupom.",
  url_nao_permitida: "Essa URL não é da Sefaz da Bahia.",
  consulta_falhou:
    "A Sefaz não respondeu. Tente de novo; a importação por foto ainda não está disponível.",
  ai_indisponivel: "O serviço de leitura está fora do ar. Tente de novo em instantes.",
  layout_nao_reconhecido:
    "Não foi possível ler este cupom. A importação por foto ainda não está disponível.",
  campo_invalido: "Confira os valores preenchidos.",
  resolucao_invalida: "Confira os valores preenchidos.",
  categoria_invalida: "Escolha uma categoria da lista.",
  cpf_nao_permitido: "Não grave CPF no cupom.",
  cupom_nao_encontrado: "Cupom não encontrado.",
  item_nao_encontrado: "Item não encontrado.",
  item_fora_da_revisao: "Este item já saiu da fila.",
  item_sem_normalizacao: "Este item ainda está sendo normalizado.",
  pergunta_invalida: "Escreva uma pergunta de até 500 caracteres.",
  limite_de_gasto: "O limite mensal de gasto com IA foi atingido.",
  llm_nao_configurado: "O agente precisa da chave do Gemini no .env.",
  agente_nao_configurado: "O agente precisa da senha AGENT_RO_PASSWORD no .env.",
  llm_indisponivel: "O modelo de IA não respondeu. Tente de novo em instantes.",
};

export class ErroApi extends Error {
  constructor(
    readonly codigo: string,
    readonly corpo: Record<string, unknown> = {},
  ) {
    super(MENSAGENS[codigo] ?? "Algo deu errado. Tente de novo.");
  }
}

export async function api<T>(caminho: string, metodo = "GET", corpo?: object): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${process.env.API_URL}${caminho}`, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: corpo && JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi("api_indisponivel");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroApi(dados.erro ?? "erro", dados);
  return dados as T;
}

export interface Normalizacao {
  produto: string;
  marca: string;
  conteudo: string | number;
  unidade_padrao: string;
  categoria: string;
}

export interface ItemCupom {
  id: number;
  codigo: string | null;
  descricao_original: string;
  quantidade: string;
  unidade: string;
  valor_unitario: string;
  valor_total: string;
  em_revisao: boolean;
  confianca: string | null;
  origem: string | null;
  normalizacao: Normalizacao | null;
}

export interface Cupom {
  id: number;
  status: "rascunho" | "confirmado" | "normalizado";
  parada: boolean;
  mercado: string;
  cnpj: string;
  chave_acesso: string;
  emitido_em: string;
  total: string;
  desconto: string;
  acrescimo: string;
  pagamento: string | null;
  itens: number;
  em_revisao: number;
  lista: ItemCupom[];
}

export type ResumoCupom = Pick<
  Cupom,
  "id" | "mercado" | "emitido_em" | "total" | "status" | "itens" | "em_revisao"
>;

export interface ItemRevisao {
  item_id: number;
  receipt_id: number;
  descricao_original: string;
  unidade: string;
  mercado: string;
  emitido_em: string;
  confianca: string;
  sugestao: Normalizacao | null;
}
