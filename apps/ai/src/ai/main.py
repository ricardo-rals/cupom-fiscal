import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ai.agent.agente import AgenteNaoConfigurado, RespostaAgente, perguntar
from ai.forecast.modelos import prever
from ai.gemini import LlmIndisponivel, LlmNaoConfigurado
from ai.nfce.ba import LayoutNaoReconhecido
from ai.nfce.consulta import PARSERS, ConsultaFalhou, UrlNaoPermitida, consultar
from ai.nfce.foto import (
    ImagemInvalida,
    OcrIndisponivel,
    ResultadoFoto,
    abrir,
    chave_da_url,
    interpretar,
    ler_com_ia,
    ler_qr,
    ocr,
)
from ai.nfce.schema import Cupom
from ai.normalize.llm import normalizar
from ai.normalize.local import normalizar_local
from ai.normalize.schema import (
    ItemNormalizado,
    NormalizeRequest,
    NormalizeResponse,
)

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
    user_id: int = Field(gt=0)


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


class FotoRequest(BaseModel):
    imagem: str = Field(max_length=11_500_000)  # base64 de até 8 MB
    usar_ia: bool = False


def _suportada(url: str) -> bool:
    try:
        return httpx.URL(url).host in PARSERS
    except httpx.InvalidURL:
        return False


@app.post("/nfce/foto")
def nfce_foto(body: FotoRequest) -> ResultadoFoto:
    """QR de Sefaz suportada volta como URL; o resto vira rascunho lido do texto."""
    try:
        imagem = abrir(body.imagem)
    except ImagemInvalida:
        raise HTTPException(400, "imagem_invalida") from None
    url = ler_qr(imagem)
    if url and _suportada(url):
        return ResultadoFoto(tipo="url", url=url)

    rascunho, chamada, leitor = None, None, "ocr"
    if body.usar_ia:
        try:
            (rascunho, chamada), leitor = ler_com_ia(imagem), "ia"
        except (LlmNaoConfigurado, LlmIndisponivel):
            pass  # sem IA disponível, o OCR local tenta
    if rascunho is None:
        try:
            rascunho = interpretar(ocr(imagem))
        except OcrIndisponivel:
            raise HTTPException(503, "ocr_indisponivel") from None
    # QR de outro estado ainda dá a chave de acesso, que o texto pode não ter.
    if url and not rascunho.chave_acesso:
        rascunho.chave_acesso = chave_da_url(url)
    return ResultadoFoto(
        tipo="rascunho", rascunho=rascunho, leitor=leitor, chamada=chamada
    )


@app.post("/normalize/batch")
def normalize_batch(body: NormalizeRequest) -> NormalizeResponse:
    try:
        return normalizar(body.itens, body.correcoes)
    except LlmNaoConfigurado:
        raise HTTPException(503, "llm_nao_configurado") from None
    except LlmIndisponivel:
        raise HTTPException(502, "llm_indisponivel") from None


class NormalizeLocalResponse(BaseModel):
    itens: list[ItemNormalizado]


@app.post("/normalize/local")
def normalize_local(body: NormalizeRequest) -> NormalizeLocalResponse:
    """Sem LLM: modelo treinado com as correções do usuário e o vocabulário de cupom."""
    return NormalizeLocalResponse(itens=normalizar_local(body.itens, body.correcoes))


@app.post("/forecast/run")
def forecast_run(body: ForecastRequest) -> dict[str, dict | None]:
    """Sem estado: a api envia as séries e grava o resultado."""
    return {s.id: prever([p.model_dump() for p in s.pontos]) for s in body.series}


@app.post("/agent/ask")
def agent_ask(body: AskRequest) -> RespostaAgente:
    try:
        return perguntar(body.pergunta, usuario=body.user_id)
    except LlmNaoConfigurado:
        raise HTTPException(503, "llm_nao_configurado") from None
    except AgenteNaoConfigurado:
        raise HTTPException(503, "agente_nao_configurado") from None
    except LlmIndisponivel:
        raise HTTPException(502, "llm_indisponivel") from None
