import json
import os
import time
from pathlib import Path

import anthropic
from anthropic import transform_schema
from rapidfuzz import fuzz, process

from ai.normalize.schema import (
    Chamada,
    Correcao,
    ItemEntrada,
    ItemNormalizado,
    NormalizeResponse,
    SaidaLlm,
)

MODELO = "claude-haiku-5-5"
PROMPT_VERSION = "v1"
PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text(
    encoding="utf-8"
)
# ponytail: preço fixo do Haiku 5.5 em prompts de até 100K tokens; atualizar se o modelo mudar.
USD_POR_TOKEN_ENTRADA = 0.10 / 1_000_000
USD_POR_TOKEN_SAIDA = 0.50 / 1_000_000
TENTATIVAS = 3  # a primeira e até 2 novas, pelo RF04
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


def normalizar(
    itens: list[ItemEntrada],
    correcoes: list[Correcao],
    cliente: anthropic.Anthropic | None = None,
) -> NormalizeResponse:
    if cliente is None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise LlmNaoConfigurado
        cliente = anthropic.Anthropic(timeout=60.0)

    conteudo = _mensagem(itens, _exemplos(itens, correcoes))
    ids = {i.id for i in itens}
    tokens_in = tokens_out = 0
    normalizados: list[ItemNormalizado] = []
    inicio = time.monotonic()

    for _ in range(TENTATIVAS):
        try:
            resposta = cliente.messages.create(
                model=MODELO,
                max_tokens=16000,
                system=PROMPT,
                messages=[{"role": "user", "content": conteudo}],
                output_config={
                    "effort": "low",
                    "format": {
                        "type": "json_schema",
                        "schema": transform_schema(SaidaLlm),
                    },
                },
            )
        except anthropic.APIError as erro:
            # O SDK já tentou de novo nos erros temporários; a api agenda outra tentativa.
            raise LlmIndisponivel(type(erro).__name__) from None

        tokens_in += resposta.usage.input_tokens
        tokens_out += resposta.usage.output_tokens
        if resposta.stop_reason != "end_turn":
            continue  # recusa ou corte por max_tokens: o conteúdo não é confiável
        texto = next((b.text for b in resposta.content if b.type == "text"), "")
        try:
            normalizados = _validar(texto, ids)
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
