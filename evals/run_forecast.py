"""Avalia a previsão em séries SINTÉTICAS e atualiza docs/results.md.

Ainda não há histórico real suficiente: nenhum produto tem 6 meses distintos de compra.
As séries são geradas com semente fixa e comportamento conhecido, por isso os números
mostram se os modelos funcionam, não quanto erram nos preços do usuário. Sem LLM e sem
custo. Rode dentro de apps/ai:

    uv run python ../../evals/run_forecast.py
"""

from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from ai.forecast.modelos import HORIZONTE, prever

RAIZ = Path(__file__).parents[1]
RESULTADOS = RAIZ / "docs/results.md"
INICIO = "<!-- previsao:inicio -->"
FIM = "<!-- previsao:fim -->"

SEMENTE = 42
SERIES_POR_TIPO = 40
MESES = 18
FALTA = 0.2  # chance de um mês sem compra
COBERTURA_ALVO = 0.8


def _gerar(tipo: str, gerador: np.random.Generator) -> np.ndarray:
    t = np.arange(MESES)
    base = gerador.uniform(3, 60)
    ruido = gerador.normal(0, 0.03, MESES)
    if tipo == "Estável":
        fator = np.ones(MESES)
    elif tipo == "Inflação constante":
        fator = (1 + gerador.uniform(0.005, 0.02)) ** t
    elif tipo == "Degrau de preço":
        fator = np.where(
            t >= gerador.integers(8, 16), 1 + gerador.uniform(0.1, 0.25), 1
        )
    elif tipo == "Sazonal":
        fator = 1 + gerador.uniform(0.08, 0.2) * np.sin(
            2 * np.pi * t / 12 + gerador.uniform(0, 6)
        )
    else:  # passeio aleatório
        fator = np.exp(np.cumsum(gerador.normal(0, 0.04, MESES)))
    return base * fator * np.exp(ruido)


TIPOS = [
    "Estável",
    "Inflação constante",
    "Degrau de preço",
    "Sazonal",
    "Passeio aleatório",
]


def _mes(indice: int) -> str:
    return f"{2025 + indice // 12}-{indice % 12 + 1:02d}"


def avaliar() -> dict:
    gerador = np.random.default_rng(SEMENTE)
    por_tipo: dict[str, list[dict]] = defaultdict(list)
    for tipo in TIPOS:
        for _ in range(SERIES_POR_TIPO):
            serie = _gerar(tipo, gerador)
            treino = MESES - HORIZONTE
            # O último mês do treino sempre tem compra: é dele que a previsão parte.
            meses = [
                m for m in range(treino) if m == treino - 1 or gerador.random() > FALTA
            ]
            resultado = prever([{"mes": _mes(m), "valor": serie[m]} for m in meses])
            if resultado is None:
                por_tipo[tipo].append({"curta": True})
                continue
            real = serie[treino:]
            previsto = np.array([p["previsto"] for p in resultado["previsoes"]])
            inferior = np.array([p["inferior"] for p in resultado["previsoes"]])
            superior = np.array([p["superior"] for p in resultado["previsoes"]])
            base = np.repeat(serie[meses[-1]], HORIZONTE)
            por_tipo[tipo].append(
                {
                    "curta": False,
                    "modelo": resultado["modelo"],
                    "erro": float(np.mean(np.abs(previsto - real) / real)),
                    "erro_base": float(np.mean(np.abs(base - real) / real)),
                    "cobertura": float(
                        np.mean((real >= inferior) & (real <= superior))
                    ),
                }
            )
    return por_tipo


def relatorio(por_tipo: dict) -> str:
    def linha(nome: str, casos: list[dict]) -> str:
        validos = [c for c in casos if not c["curta"]]
        erro = np.mean([c["erro"] for c in validos])
        base = np.mean([c["erro_base"] for c in validos])
        melhor = np.mean([c["erro"] < c["erro_base"] for c in validos])
        cobertura = np.mean([c["cobertura"] for c in validos])
        return f"| {nome} | {len(validos)} | {erro:.1%} | {base:.1%} | {melhor:.0%} | {cobertura:.0%} |"

    todos = [c for casos in por_tipo.values() for c in casos]
    validos = [c for c in todos if not c["curta"]]
    vencedores = Counter(c["modelo"] for c in validos)
    erro, base = (
        np.mean([c["erro"] for c in validos]),
        np.mean([c["erro_base"] for c in validos]),
    )
    partes = [
        "## Previsão (dados sintéticos)",
        "",
        f"- Data: {date.today().isoformat()}",
        (
            "- **Séries sintéticas, não compras reais.** Nenhum produto do usuário tem ainda os 6 meses "
            "distintos exigidos; estes números mostram se os modelos funcionam em comportamentos "
            "conhecidos, não quanto erram nos preços do usuário."
        ),
        (
            f"- {len(todos)} séries de {MESES} meses, semente {SEMENTE}, ruído de 3% e "
            f"{FALTA:.0%} de meses sem compra. Os últimos {HORIZONTE} meses ficam de fora e são previstos."
        ),
        (
            "- Erro: média do erro absoluto relativo ao preço real nos 3 meses. Baseline: repetir o "
            "último preço observado."
        ),
        "",
        (
            f"Resultado geral: erro de **{erro:.1%}** contra {base:.1%} do baseline "
            f"({'melhor' if erro < base else 'não melhor'} que o baseline, meta do spec)."
        ),
        "",
        (
            "| Comportamento | Séries | Erro | Erro do baseline | Melhor que o baseline | "
            f"Cobertura do intervalo (alvo {COBERTURA_ALVO:.0%}) |"
        ),
        "| --- | --- | --- | --- | --- | --- |",
        *(linha(tipo, casos) for tipo, casos in por_tipo.items()),
        linha("Todas", todos),
        "",
        "Modelo escolhido nos meses reservados: "
        + ", ".join(f"`{m}` {n}" for m, n in vencedores.most_common())
        + ".",
    ]
    return "\n".join(partes)


def gravar(secao: str) -> None:
    bloco = f"{INICIO}\n{secao}\n{FIM}"
    atual = (
        RESULTADOS.read_text(encoding="utf-8")
        if RESULTADOS.exists()
        else "# Resultados das avaliações\n"
    )
    if INICIO in atual:
        antes, _, resto = atual.partition(INICIO)
        atual = antes + bloco + resto.partition(FIM)[2]
    else:
        atual = atual.rstrip("\n") + "\n\n" + bloco + "\n"
    RESULTADOS.write_text(atual, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    gravar(relatorio(avaliar()))
    print(f"relatório em {RESULTADOS}")
