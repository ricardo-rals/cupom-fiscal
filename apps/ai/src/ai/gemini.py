"""Chamada ao Gemini com saída estruturada, usada pela normalização e pelo agente."""

import os

import httpx

MODELO = "gemini-3.6-flash"
URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent"
)
# ponytail: preço pago do Gemini 3.6 Flash (o mesmo do 3.8) até 31/12/2026; dobra para 1,50 e 7,50 em 2027.
USD_POR_TOKEN_ENTRADA = 0.75 / 1_000_000
USD_POR_TOKEN_SAIDA = 3.75 / 1_000_000


class LlmNaoConfigurado(Exception):
    pass


class LlmIndisponivel(Exception):
    pass


def criar_cliente(timeout_s: float) -> httpx.Client:
    chave = os.environ.get("GEMINI_API_KEY")
    if not chave:
        raise LlmNaoConfigurado
    return httpx.Client(timeout=timeout_s, headers={"x-goog-api-key": chave})


def custo(tokens_in: int, tokens_out: int) -> float:
    return tokens_in * USD_POR_TOKEN_ENTRADA + tokens_out * USD_POR_TOKEN_SAIDA


def _texto(corpo: dict) -> str:
    """Vazio em recusa ou corte por limite: o conteúdo não é confiável."""
    candidatos = corpo.get("candidates") or [{}]
    if candidatos[0].get("finishReason") != "STOP":
        return ""
    partes = candidatos[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in partes if not p.get("thought"))


def gerar(
    cliente: httpx.Client, sistema: str, mensagem: str, schema: dict
) -> tuple[str, int, int]:
    """Devolve o texto e os tokens de entrada e de saída, com o raciocínio contado na saída."""
    try:
        resposta = cliente.post(
            URL,
            json={
                "systemInstruction": {"parts": [{"text": sistema}]},
                "contents": [{"role": "user", "parts": [{"text": mensagem}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                    "thinkingConfig": {"thinkingLevel": "low"},
                },
            },
        )
        resposta.raise_for_status()
    except httpx.HTTPError as erro:
        # Sem o conteúdo do erro: ele pode repetir a requisição.
        raise LlmIndisponivel(type(erro).__name__) from None

    corpo = resposta.json()
    uso = corpo.get("usageMetadata", {})
    tokens_out = uso.get("candidatesTokenCount", 0) + uso.get("thoughtsTokenCount", 0)
    return _texto(corpo), uso.get("promptTokenCount", 0), tokens_out
