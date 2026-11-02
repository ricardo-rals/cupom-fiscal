import json
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from ai.main import app
from ai.normalize.llm import LlmIndisponivel, normalizar
from ai.normalize.schema import CATEGORIAS, Correcao, ItemEntrada

ITENS = [
    ItemEntrada(id=1, descricao="LEITE INT MARCA X 1L", unidade="UN"),
    ItemEntrada(id=2, descricao="TOMATE kg", unidade="KG"),
]


def _item(id_: int, **campos: object) -> dict[str, object]:
    return {
        "id": id_,
        "produto": "produto",
        "marca": "",
        "conteudo": 1,
        "unidade_padrao": "un",
        "categoria": "Diversos",
        "confianca": 0.9,
        **campos,
    }


VALIDO = json.dumps({"itens": [_item(1), _item(2)]})


def _mensagem(texto: str, finish_reason: str = "STOP") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "pensando", "thought": True},
                            {"text": texto},
                        ]
                    },
                    "finishReason": finish_reason,
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 1000,
                "candidatesTokenCount": 150,
                "thoughtsTokenCount": 50,
            },
        },
    )


def _cliente(
    *respostas: httpx.Response,
) -> tuple[httpx.Client, list[dict[str, object]]]:
    fila = list(respostas)
    enviados: list[dict[str, object]] = []

    def responder(requisicao: httpx.Request) -> httpx.Response:
        enviados.append(json.loads(requisicao.content))
        return fila.pop(0)

    return httpx.Client(transport=httpx.MockTransport(responder)), enviados


def test_devolve_itens_custo_e_versao_do_prompt() -> None:
    cliente, _ = _cliente(_mensagem(VALIDO))
    resposta = normalizar(ITENS, [], cliente)

    assert [i.id for i in resposta.itens] == [1, 2]
    assert resposta.prompt_version == "v2"
    assert resposta.chamada.modelo == "gemini-3.8-flash"
    assert (resposta.chamada.tokens_in, resposta.chamada.tokens_out) == (1000, 200)
    assert resposta.chamada.custo == "0.001500"


def _tokens_saida(resposta: httpx.Response) -> int:
    uso = resposta.json().get("usageMetadata", {})
    return uso.get("candidatesTokenCount", 0) + uso.get("thoughtsTokenCount", 0)


def test_requisicao_usa_saida_estruturada_e_prompt_do_arquivo() -> None:
    cliente, enviados = _cliente(_mensagem(VALIDO))
    normalizar(ITENS, [], cliente)

    corpo = enviados[0]
    assert "Você normaliza itens" in str(corpo["systemInstruction"])
    assert "Saco de lixo fica em `Limpeza da casa`" in str(corpo["systemInstruction"])
    config = corpo["generationConfig"]
    assert isinstance(config, dict)
    assert config["responseMimeType"] == "application/json"
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert "Queijos" in json.dumps(config["responseSchema"], ensure_ascii=False)


@pytest.mark.parametrize(
    "invalida",
    [
        _mensagem("isto não é json"),
        _mensagem(json.dumps({"itens": [_item(1)]})),
        _mensagem(json.dumps({"itens": [_item(1), _item(1)]})),
        _mensagem(json.dumps({"itens": [_item(1), _item(99)]})),
        _mensagem(json.dumps({"itens": [_item(1), _item(2, categoria="Inventada")]})),
        _mensagem(json.dumps({"itens": [_item(1), _item(2, confianca=1.5)]})),
        _mensagem(json.dumps({"itens": [_item(1), _item(2, conteudo=0)]})),
        _mensagem(VALIDO, finish_reason="SAFETY"),
        _mensagem(VALIDO, finish_reason="MAX_TOKENS"),
        httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}),
    ],
    ids=[
        "nao-json",
        "item-faltando",
        "id-repetido",
        "id-desconhecido",
        "categoria-fora",
        "confianca-fora",
        "conteudo-zero",
        "recusa",
        "cortada",
        "bloqueada",
    ],
)
def test_resposta_invalida_e_rejeitada_e_tenta_de_novo(
    invalida: httpx.Response,
) -> None:
    cliente, enviados = _cliente(invalida, _mensagem(VALIDO))
    resposta = normalizar(ITENS, [], cliente)

    assert len(enviados) == 2
    assert len(resposta.itens) == 2
    assert resposta.chamada.tokens_out == 200 + _tokens_saida(invalida)


def test_desiste_depois_de_duas_novas_tentativas_sem_perder_o_custo() -> None:
    cliente, enviados = _cliente(_mensagem("x"), _mensagem("x"), _mensagem("x"))
    resposta = normalizar(ITENS, [], cliente)

    assert len(enviados) == 3
    assert resposta.itens == []
    assert resposta.chamada.tokens_in == 3000


def test_erro_da_api_vira_indisponivel() -> None:
    cliente, enviados = _cliente(httpx.Response(503, json={"error": {}}))
    with pytest.raises(LlmIndisponivel):
        normalizar(ITENS, [], cliente)
    assert len(enviados) == 1


def _correcao(descricao: str) -> Correcao:
    return Correcao(
        descricao_original=descricao,
        produto="p",
        marca="",
        conteudo=1,
        unidade_padrao="un",
        categoria="Diversos",
    )


def test_exemplos_sao_os_parecidos_e_no_maximo_dez_por_item() -> None:
    parecidas = [_correcao(f"LEITE INT MARCA X 1L LOTE{i}") for i in range(15)]
    cliente, enviados = _cliente(_mensagem(VALIDO))
    normalizar(ITENS[:1] + ITENS[1:], [*parecidas, _correcao("ZZZZ QQQQ")], cliente)

    texto = json.dumps(enviados[0]["contents"], ensure_ascii=False)
    assert len(re.findall(r"LOTE\d+", texto)) == 10
    assert "ZZZZ" not in texto


def test_sem_correcoes_nao_ha_bloco_de_exemplos() -> None:
    cliente, enviados = _cliente(_mensagem(VALIDO))
    normalizar(ITENS, [], cliente)
    assert "Correções" not in json.dumps(enviados[0]["contents"], ensure_ascii=False)


def test_categorias_iguais_as_da_migration_da_api() -> None:
    migrations = Path(__file__).parents[2] / "api/prisma/migrations"
    sql = next(migrations.glob("*_taxonomia/migration.sql")).read_text(encoding="utf-8")
    no_banco = re.findall(r"^\s*\('([^']+)', '[^']+'\)", sql, re.MULTILINE)
    assert len(CATEGORIAS) == 43
    assert sorted(no_banco) == sorted(CATEGORIAS)


def test_endpoint_sem_chave_de_api(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    corpo = {"itens": [{"id": 1, "descricao": "X", "unidade": "UN"}]}
    resposta = TestClient(app).post("/normalize/batch", json=corpo)
    assert (resposta.status_code, resposta.json()["detail"]) == (
        503,
        "llm_nao_configurado",
    )


def test_endpoint_recusa_lote_acima_de_vinte() -> None:
    corpo = {"itens": [{"id": i, "descricao": "X", "unidade": "UN"} for i in range(21)]}
    assert TestClient(app).post("/normalize/batch", json=corpo).status_code == 422
