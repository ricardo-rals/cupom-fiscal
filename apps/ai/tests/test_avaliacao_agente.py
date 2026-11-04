import importlib.util
import sys
from pathlib import Path

import pytest
import yaml

from ai.agent.sql import validar

RAIZ = Path(__file__).parents[3]
especificacao = importlib.util.spec_from_file_location(
    "run_agent", RAIZ / "evals/run_agent.py"
)
avaliacao = importlib.util.module_from_spec(especificacao)
sys.modules["run_agent"] = avaliacao
especificacao.loader.exec_module(avaliacao)

DADOS = yaml.safe_load(
    (RAIZ / "evals/data/agent_questions.yaml").read_text(encoding="utf-8")
)
GABARITO = "SELECT categoria, sum(valor_total) FROM v_compras GROUP BY 1"
TOPO = "SELECT mercado FROM v_compras GROUP BY 1 ORDER BY sum(valor_total) DESC LIMIT 1"


@pytest.mark.parametrize(
    ("resposta", "certo"),
    [
        ([["Leite", 32.0], ["Aves", 10.5]], True),
        ([["Aves", 10.5], ["Leite", 32.0]], True),  # outra ordem de linhas
        ([[32.0, "leite"], [10.5, "AVES"]], True),  # outra ordem de colunas e caixa
        ([["Leite", 32.0, 3], ["Aves", 10.5, 1]], True),  # coluna a mais
        ([["Leite", 32.004], ["Aves", 10.5]], True),  # arredondamento
        ([["Leite", 32.5], ["Aves", 10.5]], False),
        ([["Leite", 32.0]], False),  # linha faltando
        ([["Leite", 32.0], ["Aves", 10.5], ["Frutas", 1.0]], False),  # linha a mais
    ],
)
def test_correta_compara_valores_em_qualquer_ordem(resposta: list, certo: bool) -> None:
    esperadas = [["Leite", 32.0], ["Aves", 10.5]]
    assert avaliacao.correta(esperadas, resposta, GABARITO) is certo


def test_pergunta_de_topo_olha_so_as_primeiras_linhas_na_ordem() -> None:
    esperadas = [["SUPERMERCADO BAHIA"]]
    lista = [["SUPERMERCADO BAHIA", 1130.36], ["ATACADAO CENTRO", 991.04]]
    assert avaliacao.correta(esperadas, lista, TOPO)
    assert not avaliacao.correta(esperadas, list(reversed(lista)), TOPO)


def test_datas_valem_com_ou_sem_horario() -> None:
    assert avaliacao.correta(
        [["2026-10-01"]], [["2026-10-01T00:00:00"]], "SELECT max(data) FROM v_compras"
    )


@pytest.mark.parametrize(
    ("sql", "insegura"),
    [
        ("SELECT * FROM v_compras", False),
        ("WITH t AS (SELECT 1) SELECT * FROM t", False),
        ("SELECT * FROM receipts", True),
        ("DELETE FROM v_compras", True),
    ],
)
def test_checagem_independente_de_consulta_insegura(sql: str, insegura: bool) -> None:
    assert avaliacao.insegura(sql) is insegura


def test_conjunto_tem_40_perguntas_e_10_adversariais_com_gabarito_valido() -> None:
    assert len(DADOS["perguntas"]) == 40
    assert len(DADOS["adversariais"]) == 10
    ids = [p["id"] for p in DADOS["perguntas"] + DADOS["adversariais"]]
    assert len(set(ids)) == 50
    for p in DADOS["perguntas"]:
        assert ("sql" in p) != bool(p.get("recusa"))
        if "sql" in p:
            validar(p["sql"])


def test_nenhuma_pergunta_do_conjunto_esta_nos_prompts_do_agente() -> None:
    prompts = " ".join(
        p.read_text(encoding="utf-8")
        for p in (RAIZ / "apps/ai/src/ai/agent/prompts").glob("*.md")
    )
    todas = DADOS["perguntas"] + DADOS["adversariais"]
    assert [p["id"] for p in todas if p["pergunta"] in prompts] == []
