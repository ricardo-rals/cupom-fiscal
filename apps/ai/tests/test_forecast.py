import numpy as np
import pytest
from fastapi.testclient import TestClient

from ai.forecast import modelos
from ai.forecast.modelos import prever
from ai.main import app


def _serie(valores: list[float], inicio: int = 1) -> list[dict]:
    return [
        {"mes": f"2026-{mes:02d}", "valor": v}
        for mes, v in enumerate(valores, start=inicio)
    ]


def test_menos_de_seis_meses_nao_preve() -> None:
    assert prever(_serie([5, 5, 5, 5, 5])) is None
    # Duas compras no mesmo mês contam como um mês só.
    assert prever(_serie([5, 5, 5, 5, 5]) + [{"mes": "2026-05", "valor": 6}]) is None


def test_inflacao_constante_escolhe_a_tendencia_e_acerta_o_proximo_mes() -> None:
    valores = [10 * 1.02**i for i in range(10)]
    resultado = prever(_serie(valores))
    assert resultado["modelo"] == "tendencia_linear"
    assert resultado["previsoes"][0]["mes"] == "2026-11"
    assert resultado["previsoes"][0]["previsto"] == pytest.approx(10 * 1.02**10)


def test_preco_parado_fica_com_o_modelo_mais_simples() -> None:
    resultado = prever(_serie([7.0] * 8))
    assert resultado["modelo"] == "ultimo_preco"
    assert [p["previsto"] for p in resultado["previsoes"]] == pytest.approx([7.0] * 3)
    assert resultado["mae_validacao"] == 0


def test_intervalo_contem_a_previsao_abre_com_o_tempo_e_nao_fica_negativo() -> None:
    gerador = np.random.default_rng(1)
    resultado = prever(_serie(list(0.5 + gerador.normal(0, 0.3, 12).clip(-0.45))))
    larguras = []
    for p in resultado["previsoes"]:
        assert 0 <= p["inferior"] <= p["previsto"] <= p["superior"]
        larguras.append(p["superior"] - p["previsto"])
    assert larguras == sorted(larguras)


def test_meses_sem_compra_sao_interpolados_e_a_previsao_parte_do_ultimo() -> None:
    pontos = [
        {"mes": m, "valor": v}
        for m, v in [
            ("2025-11", 4),
            ("2026-01", 4),
            ("2026-02", 4),
            ("2026-04", 4),
            ("2026-05", 4),
            ("2026-07", 4),
        ]
    ]
    resultado = prever(pontos)
    assert [p["mes"] for p in resultado["previsoes"]] == [
        "2026-08",
        "2026-09",
        "2026-10",
    ]
    assert resultado["previsoes"][0]["previsto"] == pytest.approx(4)


def test_endpoint_responde_cada_serie_e_marca_as_curtas() -> None:
    corpo = {
        "series": [
            {"id": "p1", "pontos": _serie([3.0] * 7)},
            {"id": "p2", "pontos": _serie([3.0] * 2)},
        ]
    }
    resposta = TestClient(app).post("/forecast/run", json=corpo).json()
    assert resposta["p1"]["modelo"] == "ultimo_preco"
    assert resposta["p2"] is None


@pytest.mark.parametrize(
    "ponto",
    [
        {"mes": "2026-13", "valor": 1},
        {"mes": "2026-01", "valor": 0},
        {"mes": "x", "valor": 1},
    ],
)
def test_endpoint_recusa_ponto_invalido(ponto: dict) -> None:
    corpo = {"series": [{"id": "p", "pontos": [ponto]}]}
    assert TestClient(app).post("/forecast/run", json=corpo).status_code == 422


@pytest.mark.parametrize(
    ("previsto_outro", "vencedor"), [(10.85, "ultimo_preco"), (10.5, "outro")]
)
def test_outro_modelo_so_substitui_o_ultimo_preco_se_errar_20_por_cento_menos(
    monkeypatch: pytest.MonkeyPatch, previsto_outro: float, vencedor: str
) -> None:
    # Nos 2 meses reservados o preço real é 10: o último preço erra 1, o outro erra 0,85 ou 0,5.
    def fixo(valor: float):
        return lambda serie, h: (np.repeat(valor, h), 0.1)

    monkeypatch.setattr(
        modelos, "MODELOS", {"ultimo_preco": fixo(11), "outro": fixo(previsto_outro)}
    )
    assert prever(_serie([10.0] * 8))["modelo"] == vencedor
