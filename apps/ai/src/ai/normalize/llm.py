import json
import os
import time
from pathlib import Path

import httpx
from rapidfuzz import fuzz, process

from ai.normalize.schema import (
    CATEGORIAS,
    Chamada,
    Correcao,
    ItemEntrada,
    ItemNormalizado,
    NormalizeResponse,
    SaidaLlm,
)

MODELO = "gemini-3.8-flash"
URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent"
)
PROMPT_VERSION = "v2"
PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text(
    encoding="utf-8"
)
# ponytail: preço pago do Gemini 3.8 Flash até 31/12/2026; dobra para 1,50 e 7,50 em 2027.
USD_POR_TOKEN_ENTRADA = 0.75 / 1_000_000
USD_POR_TOKEN_SAIDA = 3.75 / 1_000_000
TENTATIVAS = 3  # a primeira e até 2 novas, pelo RF04
TIMEOUT_S = 75.0  # as 3 tentativas cabem nos 240 s que a api espera
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "itens": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "id": {"type": "INTEGER"},
                    "produto": {"type": "STRING"},
                    "marca": {"type": "STRING"},
                    "conteudo": {"type": "NUMBER"},
                    "unidade_padrao": {"type": "STRING", "enum": ["kg", "l", "un"]},
                    "categoria": {"type": "STRING", "enum": list(CATEGORIAS)},
                    "confianca": {"type": "NUMBER"},
                },
                "required": [
                    "id",
                    "produto",
                    "marca",
                    "conteudo",
                    "unidade_padrao",
                    "categoria",
                    "confianca",
                ],
            },
        }
    },
    "required": ["itens"],
}
MAX_EXEMPLOS_POR_ITEM = 10
SIMILARIDADE_MINIMA = 60


class LlmNaoConfigurado(Exception):
    pass


class LlmIndisponivel(Exception):
    pass


def _exemplos(itens: list[ItemEntrada], correcoes: list[Correcao]) -> list[Correcao]:
    descricoes = [c.descricao_original for c in correcoes]
    indices: set[int] = set()
    for item in itens:
        parecidas = process.extract(
            item.descricao,
            descricoes,
            scorer=fuzz.token_set_ratio,
            limit=MAX_EXEMPLOS_POR_ITEM,
            score_cutoff=SIMILARIDADE_MINIMA,
        )
        indices.update(indice for _, _, indice in parecidas)
    return [correcoes[i] for i in sorted(indices)]


def _mensagem(itens: list[ItemEntrada], exemplos: list[Correcao]) -> str:
    partes = []
    if exemplos:
        corrigidos = [e.model_dump() for e in exemplos]
        texto = json.dumps(corrigidos, ensure_ascii=False)
        partes.append(
            f"Correções feitas pelo usuário, para seguir como exemplo:\n{texto}"
        )
    entrada = json.dumps([i.model_dump() for i in itens], ensure_ascii=False)
    partes.append(f"Itens para normalizar:\n{entrada}")
    return "\n\n".join(partes)


def _validar(texto: str, ids: set[int]) -> list[ItemNormalizado]:
    itens = SaidaLlm.model_validate_json(texto).itens
    if sorted(i.id for i in itens) != sorted(ids):
        raise ValueError("ids diferentes dos enviados")
    return itens


def _texto(corpo: dict) -> str:
    """Vazio em recusa ou corte por limite: o conteúdo não é confiável."""
    candidatos = corpo.get("candidates") or [{}]
    if candidatos[0].get("finishReason") != "STOP":
        return ""
    partes = candidatos[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in partes if not p.get("thought"))


def normalizar(
    itens: list[ItemEntrada],
    correcoes: list[Correcao],
    cliente: httpx.Client | None = None,
) -> NormalizeResponse:
    if cliente is None:
        chave = os.environ.get("GEMINI_API_KEY")
        if not chave:
            raise LlmNaoConfigurado
        cliente = httpx.Client(timeout=TIMEOUT_S, headers={"x-goog-api-key": chave})

    conteudo = _mensagem(itens, _exemplos(itens, correcoes))
    ids = {i.id for i in itens}
    tokens_in = tokens_out = 0
    normalizados: list[ItemNormalizado] = []
    inicio = time.monotonic()

    for _ in range(TENTATIVAS):
        try:
            resposta = cliente.post(
                URL,
                json={
                    "systemInstruction": {"parts": [{"text": PROMPT}]},
                    "contents": [{"role": "user", "parts": [{"text": conteudo}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseSchema": SCHEMA,
                        "thinkingConfig": {"thinkingLevel": "low"},
                    },
                },
            )
            resposta.raise_for_status()
        except httpx.HTTPError as erro:
            # A api agenda outra tentativa com intervalo maior, e os lotes prontos ficam salvos.
            raise LlmIndisponivel(type(erro).__name__) from None

        corpo = resposta.json()
        uso = corpo.get("usageMetadata", {})
        tokens_in += uso.get("promptTokenCount", 0)
        # O raciocínio é cobrado como saída.
        tokens_out += uso.get("candidatesTokenCount", 0) + uso.get(
            "thoughtsTokenCount", 0
        )
        try:
            normalizados = _validar(_texto(corpo), ids)
            break
        except ValueError:  # inclui ValidationError do Pydantic
            continue

    custo = tokens_in * USD_POR_TOKEN_ENTRADA + tokens_out * USD_POR_TOKEN_SAIDA
    return NormalizeResponse(
        itens=normalizados,
        chamada=Chamada(
            modelo=MODELO,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            custo=f"{custo:.6f}",
            latencia_ms=round((time.monotonic() - inicio) * 1000),
        ),
        prompt_version=PROMPT_VERSION,
    )
