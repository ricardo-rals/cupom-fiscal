from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ai.agent.agente import AgenteNaoConfigurado, RespostaAgente, perguntar
from ai.forecast.modelos import prever
from ai.gemini import LlmIndisponivel, LlmNaoConfigurado
from ai.nfce.ba import LayoutNaoReconhecido
from ai.nfce.consulta import ConsultaFalhou, UrlNaoPermitida, consultar
from ai.nfce.schema import Cupom
from ai.normalize.llm import normalizar
from ai.normalize.schema import NormalizeRequest, NormalizeResponse

app = FastAPI(title="cupom-fiscal ai")


class PontoSerie(BaseModel):
    mes: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    valor: float = Field(gt=0)


class Serie(BaseModel):
    id: str = Field(max_length=50)
    pontos: list[PontoSerie] = Field(max_length=240)


class ForecastRequest(BaseModel):
    series: list[Serie] = Field(max_length=5000)


class AskRequest(BaseModel):
    pergunta: str = Field(min_length=1, max_length=500)


class NfceParseRequest(BaseModel):
    url: str = Field(max_length=2048)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/nfce/parse")
def nfce_parse(body: NfceParseRequest) -> Cupom:
    try:
        return consultar(body.url)
    except UrlNaoPermitida:
        raise HTTPException(400, "url_nao_permitida") from None
    except ConsultaFalhou:
        raise HTTPException(502, "consulta_falhou") from None
    except LayoutNaoReconhecido:
        raise HTTPException(422, "layout_nao_reconhecido") from None


@app.post("/normalize/batch")
def normalize_batch(body: NormalizeRequest) -> NormalizeResponse:
    try:
        return normalizar(body.itens, body.correcoes)
    except LlmNaoConfigurado:
        raise HTTPException(503, "llm_nao_configurado") from None
    except LlmIndisponivel:
        raise HTTPException(502, "llm_indisponivel") from None


@app.post("/forecast/run")
def forecast_run(body: ForecastRequest) -> dict[str, dict | None]:
    """Sem estado: a api envia as séries e grava o resultado."""
    return {s.id: prever([p.model_dump() for p in s.pontos]) for s in body.series}


@app.post("/agent/ask")
def agent_ask(body: AskRequest) -> RespostaAgente:
    try:
        return perguntar(body.pergunta)
    except LlmNaoConfigurado:
        raise HTTPException(503, "llm_nao_configurado") from None
    except AgenteNaoConfigurado:
        raise HTTPException(503, "agente_nao_configurado") from None
    except LlmIndisponivel:
        raise HTTPException(502, "llm_indisponivel") from None
