from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ai.nfce.ba import LayoutNaoReconhecido
from ai.nfce.consulta import ConsultaFalhou, UrlNaoPermitida, consultar
from ai.nfce.schema import Cupom

app = FastAPI(title="cupom-fiscal ai")


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
