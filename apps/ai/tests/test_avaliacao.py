import csv
import importlib.util
import sys
from pathlib import Path

import pytest

from ai.normalize.schema import CATEGORIAS

RAIZ = Path(__file__).parents[3]
GOLD = RAIZ / "evals/data/normalization_gold.csv"
PROMPTS = RAIZ / "apps/ai/src/ai/normalize/prompts"

especificacao = importlib.util.spec_from_file_location(
    "run_normalization", RAIZ / "evals/run_normalization.py"
)
avaliacao = importlib.util.module_from_spec(especificacao)
sys.modules["run_normalization"] = avaliacao
especificacao.loader.exec_module(avaliacao)

ESPERADO = {
    "produto": "Feijão Preto",
    "marca": "Rubi",
    "conteudo": "1",
    "unidade_padrao": "kg",
    "categoria": "Arroz e feijão",
}
CERTO = {**ESPERADO, "produto": "feijao preto", "marca": "RUBI", "conteudo": 1.0}


def _gold() -> list[dict[str, str]]:
    with GOLD.open(encoding="utf-8-sig", newline="") as arquivo:
        return list(csv.DictReader(arquivo, delimiter=";"))


def test_ignora_acento_e_caixa() -> None:
    assert all(avaliacao.pontuar(ESPERADO, CERTO).values())


@pytest.mark.parametrize(
    ("campos", "errado", "certo"),
    [
        ({"categoria": "Massas"}, "categoria", "produto_e_unidade"),
        ({"unidade_padrao": "un"}, "produto_e_unidade", "produto"),
        ({"produto": "macarrão parafuso"}, "produto_e_unidade", "unidade"),
        ({"conteudo": 1.5}, "conteudo", "categoria"),
    ],
)
def test_cada_metrica_erra_sozinha(campos: dict, errado: str, certo: str) -> None:
    acertos = avaliacao.pontuar(ESPERADO, {**CERTO, **campos})
    assert not acertos[errado]
    assert acertos[certo]


def test_nome_parcial_nao_conta_como_o_mesmo_produto() -> None:
    previsto = {**CERTO, "produto": "feijão preto tipo 1 orgânico selecionado"}
    assert not avaliacao.pontuar(ESPERADO, previsto)["produto"]


def test_sem_resposta_e_erro_em_tudo() -> None:
    assert not any(avaliacao.pontuar(ESPERADO, None).values())


def test_conjunto_esta_integro() -> None:
    linhas = _gold()
    assert len(linhas) == 200
    assert len({x["descricao_original"] for x in linhas}) == 200
    assert {x["categoria"] for x in linhas} <= set(CATEGORIAS)
    assert sum(x["origem"] == "sintetico" for x in linhas) == 55


def test_nenhum_exemplo_do_conjunto_esta_nos_prompts() -> None:
    prompts = " ".join(p.read_text(encoding="utf-8") for p in PROMPTS.glob("*.md"))
    assert [
        x["descricao_original"] for x in _gold() if x["descricao_original"] in prompts
    ] == []


def test_gravar_preserva_as_outras_secoes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resultados = tmp_path / "results.md"
    monkeypatch.setattr(avaliacao, "RESULTADOS", resultados)
    avaliacao.gravar("primeira")
    resultados.write_text(
        resultados.read_text(encoding="utf-8") + "\n## Agente\n", encoding="utf-8"
    )
    avaliacao.gravar("segunda")
    texto = resultados.read_text(encoding="utf-8")
    assert "segunda" in texto
    assert "primeira" not in texto
    assert "## Agente" in texto
