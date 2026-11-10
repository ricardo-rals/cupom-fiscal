"""Compara a normalização sem IA com a do LLM e atualiza docs/results.md.

Não gasta nada: o modelo local roda aqui, e as respostas do LLM vêm de
docs/normalization_predicoes.json, salvas por run_normalization.py. Rode dentro de apps/ai:

    uv run python ../../evals/run_normalization_local.py

O modelo local é treinado com o próprio conjunto de avaliação, então a medida é por validação
cruzada em 5 partes: cada item é previsto por um modelo que nunca o viu.
"""

import time

import numpy as np
from run_normalization import (
    LIMIAR,
    RESULTADOS,
    carregar_gold,
    carregar_lotes,
    fatia,
    pontuar,
)
from sklearn.model_selection import KFold

from ai.normalize.local import normalizar_local
from ai.normalize.schema import Correcao, ItemEntrada

INICIO = "<!-- normalizacao-local:inicio -->"
FIM = "<!-- normalizacao-local:fim -->"
PARTES = 5
LIMIAR_LOCAL = 0.5  # padrão de NORMALIZACAO_LIMIAR_LOCAL na api


def correcao(g: dict) -> Correcao:
    return Correcao(
        descricao_original=g["descricao_original"],
        produto=g["produto"],
        marca=g["marca"],
        conteudo=float(g["conteudo"]),
        unidade_padrao=g["unidade_padrao"],
        categoria=g["categoria"],
    )


def prever_local(gold: list[dict]) -> tuple[dict[int, dict], float]:
    previstos: dict[int, dict] = {}
    inicio = time.monotonic()
    for treino, teste in KFold(PARTES, shuffle=True, random_state=0).split(gold):
        base = tuple(correcao(gold[i]) for i in treino)
        itens = [
            ItemEntrada(
                id=int(i),
                descricao=gold[i]["descricao_original"],
                unidade=gold[i]["unidade"],
            )
            for i in teste
        ]
        for item in normalizar_local(itens, [], base=base):
            previstos[item.id] = item.model_dump()
    return previstos, (time.monotonic() - inicio) / len(gold) * 1000


def linhas(gold: list[dict], previstos: dict[int, dict]) -> list[dict]:
    return [
        {**g, "previsto": previstos.get(i), "acertos": pontuar(g, previstos.get(i))}
        for i, g in enumerate(gold)
    ]


def confianca(grupo: list[dict], limiar: float) -> str:
    acima = [x for x in grupo if x["previsto"] and x["previsto"]["confianca"] >= limiar]
    if not acima:
        return "nenhum item acima"
    acerto = np.mean([x["acertos"]["categoria"] for x in acima])
    return f"{len(acima)} de {len(grupo)} itens, com {acerto:.1%} de acerto de categoria"


def relatorio(gold: list[dict], local: dict[int, dict], ms_por_item: float) -> str:
    llm = {
        item["id"]: item
        for lote in carregar_lotes().values()
        for item in lote["itens"]
    }
    modos = {"Com IA (LLM)": linhas(gold, llm), "Sem IA (local)": linhas(gold, local)}
    reais = {k: [x for x in v if x["origem"] == "real"] for k, v in modos.items()}
    metricas = [
        ("categoria", "Categoria"),
        ("produto_e_unidade", "Produto e unidade"),
        ("unidade", "Unidade padrão"),
        ("conteudo", "Conteúdo, tolerância de 1%"),
        ("marca", "Marca"),
    ]
    partes = [
        "## Normalização com e sem IA",
        "",
        (
            f"- Sem IA: validação cruzada em {PARTES} partes, cada item previsto por um modelo "
            "treinado com os outros 4/5 do conjunto e com o vocabulário de `lexico.py`."
        ),
        "- Com IA: as respostas salvas da seção anterior, sem nova chamada.",
        f"- Tempo do modelo local, incluindo o treino: {ms_por_item:.0f} ms por item.",
        "",
        "| Métrica | " + " | ".join(f"{m}, todos | {m}, reais" for m in modos) + " |",
        "| --- | " + " | ".join("--- | ---" for _ in modos) + " |",
    ]
    for chave, nome in metricas:
        valores = " | ".join(
            f"{fatia(modos[m])[chave]:.1%} | {fatia(reais[m])[chave]:.1%}"
            for m in modos
        )
        partes.append(f"| {nome} | {valores} |")
    partes += [
        "",
        "### Confiança",
        "",
        f"- Com IA, limiar {LIMIAR}: {confianca(modos['Com IA (LLM)'], LIMIAR)}.",
        f"- Sem IA, limiar {LIMIAR_LOCAL}: {confianca(modos['Sem IA (local)'], LIMIAR_LOCAL)}.",
        "- O que fica abaixo do limiar vai para a fila de revisão com a sugestão preenchida.",
        "",
        "### Como ler",
        "",
        (
            "- Sem IA o nome do produto é a descrição do cupom limpa: abreviações como `QJ MUSS` "
            "não viram `queijo mussarela`. Por isso produto e marca ficam bem abaixo do LLM; "
            "categoria, conteúdo e unidade são o que o modelo local acerta."
        ),
        (
            "- No uso real o modelo também aprende com as correções do usuário: item igual a um "
            "já corrigido copia a correção, e cada correção vira exemplo de treino."
        ),
    ]
    return "\n".join(partes)


def gravar(secao: str) -> None:
    atual = RESULTADOS.read_text(encoding="utf-8")
    bloco = f"{INICIO}\n{secao}\n{FIM}"
    if INICIO not in atual:
        RESULTADOS.write_text(
            atual.rstrip("\n") + "\n\n" + bloco + "\n", encoding="utf-8", newline="\n"
        )
        return
    antes, _, resto = atual.partition(INICIO)
    _, _, depois = resto.partition(FIM)
    RESULTADOS.write_text(antes + bloco + depois, encoding="utf-8", newline="\n")


def main() -> None:
    gold = carregar_gold()
    local, ms = prever_local(gold)
    gravar(relatorio(gold, local, ms))
    print(f"relatório em {RESULTADOS}")


if __name__ == "__main__":
    main()
