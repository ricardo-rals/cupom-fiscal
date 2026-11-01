import httpx

from ai.nfce.ba import parse_ba
from ai.nfce.schema import Cupom

# Também é a lista de hosts permitidos: a URL vem do usuário.
PARSERS = {"nfe.sefaz.ba.gov.br": parse_ba}
USER_AGENT = "cupom-fiscal/0.1 (projeto pessoal; github.com/ricardo-rals/cupom-fiscal)"


class UrlNaoPermitida(Exception):
    pass


class ConsultaFalhou(Exception):
    pass


def _validar(url: httpx.URL) -> None:
    if (
        url.scheme not in ("http", "https")
        or url.host not in PARSERS
        or url.port is not None
    ):
        raise UrlNaoPermitida


def _validar_requisicao(requisicao: httpx.Request) -> None:
    _validar(requisicao.url)  # roda em cada redirect


def consultar(url: str, transport: httpx.BaseTransport | None = None) -> Cupom:
    try:
        destino = httpx.URL(url.strip())
    except httpx.InvalidURL:
        raise UrlNaoPermitida from None
    _validar(destino)

    try:
        with httpx.Client(
            transport=transport,
            timeout=10,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            event_hooks={"request": [_validar_requisicao]},
        ) as cliente:
            resposta = cliente.get(destino)
            resposta.raise_for_status()
    except httpx.HTTPError as erro:
        raise ConsultaFalhou(type(erro).__name__) from None
    return PARSERS[destino.host](resposta.text)
