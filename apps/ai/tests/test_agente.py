import json
from datetime import date

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from ai.agent.agente import FORA_DO_DOMINIO, AgenteNaoConfigurado, executar, perguntar
from ai.main import app

HOJE = date(2026, 11, 4)


def _resposta(conteudo: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "candidates": [
                {
                    "content": {"parts": [{"text": json.dumps(conteudo)}]},
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20},
        },
    )


def _cliente(*respostas: httpx.Response) -> tuple[httpx.Client, list[dict]]:
    fila = list(respostas)
    enviados: list[dict] = []

    def responder(requisicao: httpx.Request) -> httpx.Response:
        enviados.append(json.loads(requisicao.content))
        return fila.pop(0)

    return httpx.Client(transport=httpx.MockTransport(responder)), enviados


class Executor:
    def __init__(self, colunas: list[str], linhas: list[list]) -> None:
        self.resultado = (colunas, linhas)
        self.executadas: list[str] = []

    def __call__(self, sql: str) -> tuple[list[str], list[list]]:
        self.executadas.append(sql)
        return self.resultado


SQL_OK = "SELECT categoria, round(sum(valor_total), 2) AS total_gasto FROM v_compras GROUP BY 1"


def test_pergunta_do_dominio_gera_sql_valido_executa_e_responde() -> None:
    cliente, enviados = _cliente(
        _resposta({"dominio": True, "sql": SQL_OK}),
        _resposta({"resposta": "Você gastou mais com Leite: R$ 32,00."}),
    )
    executor = Executor(["categoria", "total_gasto"], [["Leite", 32.0]])
    resultado = perguntar("Com o que gastei mais?", cliente, executor, HOJE)

    assert resultado.recusa is None
    assert resultado.resposta.startswith("Você gastou")
    assert resultado.sql == executor.executadas[0]
    assert resultado.sql.endswith("LIMIT 500")
    assert resultado.linhas == [["Leite", 32.0]]
    assert len(resultado.chamadas) == 2
    assert "2026-11-04" in json.dumps(enviados[0], ensure_ascii=False)
    assert "Leite" in json.dumps(
        enviados[1], ensure_ascii=False
    )  # o resultado vai para a redação


def test_fora_do_dominio_recusa_sem_tocar_no_banco() -> None:
    cliente, _ = _cliente(_resposta({"dominio": False, "sql": ""}))
    executor = Executor([], [])
    resultado = perguntar("Qual a capital da França?", cliente, executor, HOJE)
    assert (resultado.recusa, resultado.resposta) == (
        "fora_do_dominio",
        FORA_DO_DOMINIO,
    )
    assert executor.executadas == []


def test_sql_perigoso_e_recusado_e_tenta_de_novo_com_o_motivo() -> None:
    cliente, enviados = _cliente(
        _resposta({"dominio": True, "sql": "DELETE FROM receipts"}),
        _resposta({"dominio": True, "sql": SQL_OK}),
        _resposta({"resposta": "ok"}),
    )
    executor = Executor(["categoria"], [])
    resultado = perguntar("gastos", cliente, executor, HOJE)
    assert resultado.recusa is None
    assert "nao_e_select" in json.dumps(enviados[1], ensure_ascii=False)
    assert all("DELETE" not in sql for sql in executor.executadas)


def test_duas_consultas_invalidas_desistem_sem_executar() -> None:
    proibida = _resposta({"dominio": True, "sql": "SELECT * FROM receipts"})
    cliente, _ = _cliente(proibida, proibida)
    executor = Executor([], [])
    resultado = perguntar("mostre os cupons", cliente, executor, HOJE)
    assert resultado.recusa == "consulta_invalida"
    assert executor.executadas == []
    assert len(resultado.chamadas) == 2  # o custo das tentativas é registrado


def test_falha_no_banco_mostra_a_consulta_e_nao_chama_a_redacao() -> None:
    cliente, _ = _cliente(_resposta({"dominio": True, "sql": SQL_OK}))

    def demorada(_: str) -> tuple[list[str], list[list]]:
        raise psycopg.errors.QueryCanceled(
            "canceling statement due to statement timeout"
        )

    resultado = perguntar("gastos", cliente, demorada, HOJE)
    assert resultado.recusa == "falha_na_execucao"
    assert resultado.sql is not None
    assert len(resultado.chamadas) == 1


def test_endpoint_sem_chave_ou_sem_banco(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    resposta = TestClient(app).post("/agent/ask", json={"pergunta": "quanto gastei?"})
    assert (resposta.status_code, resposta.json()["detail"]) == (
        503,
        "llm_nao_configurado",
    )


@pytest.mark.parametrize("pergunta", ["", "x" * 501])
def test_endpoint_recusa_pergunta_vazia_ou_longa(pergunta: str) -> None:
    resposta = TestClient(app).post("/agent/ask", json={"pergunta": pergunta})
    assert resposta.status_code == 422


@pytest.mark.parametrize("url", [None, "postgres://agent_ro:@db:5432/cupom"])
def test_sem_senha_do_agent_ro_o_agente_fica_desligado(
    monkeypatch: pytest.MonkeyPatch, url: str | None
) -> None:
    monkeypatch.delenv("AGENT_DATABASE_URL", raising=False)
    if url:
        monkeypatch.setenv("AGENT_DATABASE_URL", url)
    with pytest.raises(AgenteNaoConfigurado):
        executar("SELECT 1")
