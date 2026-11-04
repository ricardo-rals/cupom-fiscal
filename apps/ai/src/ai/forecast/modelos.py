"""Previsão mensal de preço: escolhe entre três modelos pelo erro nos meses reservados."""

import warnings
from collections.abc import Callable
from datetime import date

import numpy as np
from statsmodels.tsa.holtwinters import SimpleExpSmoothing

MESES_MIN = 6  # RF08: observações em meses distintos
RESERVADOS = 2
HORIZONTE = 3
MARGEM_PARA_TROCAR = 0.8  # o outro modelo precisa errar pelo menos 20% menos
Z_80 = 1.2816  # quantil de 90% da normal: intervalo central de 80%

# (previsões, desvio de um passo) para h meses à frente
Modelo = Callable[[np.ndarray, int], tuple[np.ndarray, float]]


def _mes(texto: str) -> int:
    ano, mes = map(int, texto.split("-"))
    return ano * 12 + mes - 1


def _texto(indice: int) -> str:
    return date(indice // 12, indice % 12 + 1, 1).isoformat()[:7]


def _desvio(residuos: np.ndarray) -> float:
    return float(np.std(residuos, ddof=1)) if len(residuos) > 1 else 0.0


def ultimo_preco(serie: np.ndarray, h: int) -> tuple[np.ndarray, float]:
    return np.repeat(serie[-1], h), _desvio(np.diff(serie))


def tendencia_linear(serie: np.ndarray, h: int) -> tuple[np.ndarray, float]:
    """Reta sobre o log do preço: inflação vira crescimento percentual constante."""
    t = np.arange(len(serie))
    inclinacao, intercepto = np.polyfit(t, np.log(serie), 1)
    ajuste = np.exp(intercepto + inclinacao * t)
    futuro = np.exp(intercepto + inclinacao * np.arange(len(serie), len(serie) + h))
    return futuro, _desvio(serie - ajuste)


def suavizacao(serie: np.ndarray, h: int) -> tuple[np.ndarray, float]:
    # Série curta ou sem variação gera avisos de convergência e de log(0) no AIC, que não usamos.
    with warnings.catch_warnings(), np.errstate(divide="ignore", invalid="ignore"):
        warnings.simplefilter("ignore")
        ajuste = SimpleExpSmoothing(serie, initialization_method="estimated").fit()
        return np.asarray(ajuste.forecast(h)), _desvio(np.asarray(ajuste.resid))


MODELOS: dict[str, Modelo] = {
    "ultimo_preco": ultimo_preco,
    "tendencia_linear": tendencia_linear,
    "suavizacao_exponencial": suavizacao,
}


def _grade(pontos: list[dict]) -> tuple[int, np.ndarray, np.ndarray]:
    """Meses sem compra viram interpolação geométrica entre os vizinhos."""
    meses = {_mes(p["mes"]): float(p["valor"]) for p in pontos}
    inicio, fim = min(meses), max(meses)
    grade = np.arange(inicio, fim + 1)
    observado = np.array([m in meses for m in grade])
    conhecidos = sorted(meses)
    serie = np.exp(np.interp(grade, conhecidos, [np.log(meses[m]) for m in conhecidos]))
    return fim, serie, observado


def prever(pontos: list[dict]) -> dict | None:
    """None quando há menos de MESES_MIN meses com compra."""
    if len({p["mes"] for p in pontos}) < MESES_MIN:
        return None
    fim, serie, observado = _grade(pontos)

    treino, teste = serie[:-RESERVADOS], serie[-RESERVADOS:]
    reais = observado[-RESERVADOS:]  # mês interpolado não conta como erro medido
    erros = {}
    for nome, modelo in MODELOS.items():
        try:
            previsto, _ = modelo(treino, RESERVADOS)
        except (ValueError, np.linalg.LinAlgError):
            continue
        erros[nome] = float(np.mean(np.abs(previsto - teste)[reais]))

    # O último preço é o padrão; outro modelo só entra se errar claramente menos, porque
    # 2 meses reservados são pouco e um acerto por acaso não deve virar tendência.
    vencedor = min(erros, key=erros.get)
    if erros[vencedor] >= MARGEM_PARA_TROCAR * erros["ultimo_preco"]:
        vencedor = "ultimo_preco"
    previsto, desvio = MODELOS[vencedor](serie, HORIZONTE)
    # ponytail: intervalo normal que abre com a raiz do horizonte; trocar por bootstrap
    # dos resíduos se a cobertura medida em evals/run_forecast.py ficar longe de 80%.
    margem = Z_80 * desvio * np.sqrt(np.arange(1, HORIZONTE + 1))
    return {
        "modelo": vencedor,
        "mae_validacao": erros[vencedor],
        "erros": erros,
        "ultimo": float(serie[-1]),
        "previsoes": [
            {
                "mes": _texto(fim + passo),
                "previsto": float(p),
                "inferior": float(max(p - m, 0.0)),
                "superior": float(p + m),
            }
            for passo, (p, m) in enumerate(zip(previsto, margem, strict=True), start=1)
        ],
    }
