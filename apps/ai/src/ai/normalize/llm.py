import json
import time
from pathlib import Path

import httpx
from rapidfuzz import fuzz, process

from ai.gemini import (
    MODELO,
    criar_cliente,
    custo,
    gerar,
    trace_id_atual,
)
from ai.normalize.schema import (
    CATEGORIAS,
    Chamada,
    Correcao,
    ItemEntrada,
    ItemNormalizado,
    NormalizeResponse,
    SaidaLlm,
)

PROMPT_VERSION = "v2"
PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text(
    encoding="utf-8"
)
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
    cliente: httpx.Client | None = None,
) -> NormalizeResponse:
    cliente = cliente or criar_cliente(TIMEOUT_S)

    conteudo = _mensagem(itens, _exemplos(itens, correcoes))
    ids = {i.id for i in itens}
    tokens_in = tokens_out = 0
    normalizados: list[ItemNormalizado] = []
    inicio = time.monotonic()

    for _ in range(TENTATIVAS):
        # Erro de rede sobe como LlmIndisponivel: a api tenta de novo, e os lotes prontos ficam salvos.
        texto, entrada, saida = gerar(cliente, PROMPT, conteudo, SCHEMA)
        tokens_in += entrada
        tokens_out += saida
        try:
            normalizados = _validar(texto, ids)
            break
        except ValueError:  # inclui ValidationError do Pydantic
            continue

    return NormalizeResponse(
        itens=normalizados,
        chamada=Chamada(
            modelo=MODELO,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            custo=f"{custo(tokens_in, tokens_out):.6f}",
            latencia_ms=round((time.monotonic() - inicio) * 1000),
            trace_id=trace_id_atual(),
        ),
        prompt_version=PROMPT_VERSION,
    )
