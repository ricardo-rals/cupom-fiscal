import json

import httpx
import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from ai.gemini import LlmIndisponivel, LlmNaoConfigurado, gerar
from ai.normalize.llm import normalizar
from ai.normalize.schema import ItemEntrada

EXPORTADOR = InMemorySpanExporter()
_provedor = TracerProvider()
_provedor.add_span_processor(SimpleSpanProcessor(EXPORTADOR))
trace.set_tracer_provider(_provedor)

RESPOSTA = {
    "candidates": [
        {
            "content": {"parts": [{"text": '{"ok": true}'}]},
            "finishReason": "STOP",
        }
    ],
    "usageMetadata": {
        "promptTokenCount": 1000,
        "candidatesTokenCount": 150,
        "thoughtsTokenCount": 50,
    },
}


def _cliente(resposta: httpx.Response) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda _: resposta))


@pytest.fixture(autouse=True)
def _limpar() -> None:
    EXPORTADOR.clear()


def test_cada_chamada_vira_span_com_prompt_resposta_tokens_e_custo() -> None:
    cliente = _cliente(httpx.Response(200, json=RESPOSTA))
    gerar(cliente, "sistema", "mensagem do usuário", {})

    (span,) = EXPORTADOR.get_finished_spans()
    assert span.name == "chat gemini-3.6-flash"
    assert span.attributes["llm.sistema"] == "sistema"
    assert span.attributes["llm.mensagem"] == "mensagem do usuário"
    assert span.attributes["llm.resposta"] == '{"ok": true}'
    assert span.attributes["gen_ai.usage.input_tokens"] == 1000
    assert span.attributes["gen_ai.usage.output_tokens"] == 200
    assert span.attributes["llm.custo_usd"] == pytest.approx(0.0015)
    assert span.end_time >= span.start_time  # a latência é a duração do span


def test_falha_marca_o_span_como_erro_sem_guardar_a_resposta() -> None:
    cliente = _cliente(httpx.Response(503, json={"error": {"message": "x"}}))
    with pytest.raises(LlmIndisponivel):
        gerar(cliente, "sistema", "mensagem", {})
    (span,) = EXPORTADOR.get_finished_spans()
    assert span.status.status_code == trace.StatusCode.ERROR
    assert "llm.resposta" not in span.attributes


def test_texto_grande_e_cortado() -> None:
    cliente = _cliente(httpx.Response(200, json=RESPOSTA))
    gerar(cliente, "s", "x" * 50_000, {})
    (span,) = EXPORTADOR.get_finished_spans()
    assert len(span.attributes["llm.mensagem"]) == 16_000


def test_chamada_registrada_leva_o_id_do_trace() -> None:
    valido = {
        "itens": [
            {
                "id": 1,
                "produto": "p",
                "marca": "",
                "conteudo": 1,
                "unidade_padrao": "un",
                "categoria": "Diversos",
                "confianca": 0.9,
            }
        ]
    }
    corpo = {
        **RESPOSTA,
        "candidates": [
            {
                "content": {"parts": [{"text": json.dumps(valido)}]},
                "finishReason": "STOP",
            }
        ],
    }
    tracer = trace.get_tracer("teste")
    with tracer.start_as_current_span("requisicao") as raiz:
        resposta = normalizar(
            [ItemEntrada(id=1, descricao="X", unidade="UN")],
            [],
            _cliente(httpx.Response(200, json=corpo)),
        )
    assert resposta.chamada.trace_id == trace.format_trace_id(
        raiz.get_span_context().trace_id
    )


def test_chave_recusada_nao_vira_nova_tentativa() -> None:
    cliente = _cliente(httpx.Response(401, json={"error": {"code": 401}}))
    with pytest.raises(LlmNaoConfigurado):
        gerar(cliente, "sistema", "mensagem", {})
