from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from ai.main import app
from ai.nfce.ba import LayoutNaoReconhecido, parse_ba
from ai.nfce.consulta import ConsultaFalhou, UrlNaoPermitida, consultar

HTML = (Path(__file__).parent / "fixtures/nfce_ba/cupom_1.html").read_text(
    encoding="utf-8"
)
URL = "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=2926|2|1|1|ABC"


def _transporte(resposta: httpx.Response) -> httpx.MockTransport:
    return httpx.MockTransport(lambda _: resposta)


def test_cabecalho_e_totais() -> None:
    cupom = parse_ba(HTML)
    assert cupom.cnpj == "28548486001430"
    assert cupom.nome == "MULTICOM ATACADO E VAREJO S/A"
    assert cupom.cidade == "VITORIA DA CONQUISTA"
    assert cupom.emitido_em == datetime(
        2026, 10, 26, 14, 31, 57, tzinfo=timezone(timedelta(hours=-3))
    )
    assert len(cupom.chave_acesso) == 44
    assert cupom.total == Decimal("522.68")
    assert cupom.desconto == cupom.acrescimo == Decimal(0)
    assert cupom.pagamento == "99 - Outros"


def test_itens() -> None:
    itens = parse_ba(HTML).itens
    assert len(itens) == 46
    assert sum(i.valor_total for i in itens) == Decimal("522.68")

    queijo = itens[2]
    assert queijo.codigo == "74370"
    assert queijo.descricao_original == "QJ LAC GLORIA MUSS FAT kg"
    assert (queijo.quantidade, queijo.unidade) == (Decimal("0.322"), "KG")
    assert (queijo.valor_unitario, queijo.valor_total) == (
        Decimal("47.98"),
        Decimal("15.45"),
    )

    # O mesmo produto em duas linhas continua sendo duas compras.
    assert sum(i.codigo == "69949" for i in itens) == 2


def test_cpf_do_consumidor_nao_sai_do_parser() -> None:
    html = HTML.replace("***.***.***-**", "000.000.000-00")
    assert "000.000.000-00" in html
    assert "000.000.000" not in parse_ba(html).model_dump_json()


@pytest.mark.parametrize(
    ("fixture", "cnpj", "qtd", "total", "desconto", "pagamento"),
    [
        (
            "cupom_2",
            "00776574138182",
            2,
            "12.99",
            "5.99",
            "3 - Cartão de Crédito",
        ),
        (
            "cupom_3",
            "46708841001473",
            1,
            "39.99",
            "40.00",
            "4 - Cartão de Débito",
        ),
        # A Sefaz às vezes mostra só o código da forma de pagamento.
        ("cupom_4", "06626253121102", 2, "16.79", "0", "18"),
    ],
)
def test_outros_cupons_reais(
    fixture: str, cnpj: str, qtd: int, total: str, desconto: str, pagamento: str
) -> None:
    html = (Path(__file__).parent / f"fixtures/nfce_ba/{fixture}.html").read_text(
        encoding="utf-8"
    )
    cupom = parse_ba(html)
    assert cupom.cnpj == cnpj
    assert len(cupom.itens) == qtd
    assert cupom.total == Decimal(total)
    assert cupom.desconto == Decimal(desconto)
    assert cupom.pagamento == pagamento
    assert sum(i.valor_total for i in cupom.itens) - cupom.desconto == cupom.total


@pytest.mark.parametrize(
    "html",
    ["<html><body>Nota não encontrada</body></html>", HTML.replace(">46<", ">47<")],
    ids=["pagina-desconhecida", "qtd-incoerente"],
)
def test_layout_nao_reconhecido(html: str) -> None:
    with pytest.raises(LayoutNaoReconhecido):
        parse_ba(html)


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data",
        "http://localhost:3000/",
        "http://nfe.sefaz.ba.gov.br.evil.com/",
        "http://nfe.sefaz.ba.gov.br:8080/",
        "file:///etc/passwd",
        "texto qualquer",
    ],
)
def test_url_fora_da_sefaz_e_recusada(url: str) -> None:
    with pytest.raises(UrlNaoPermitida):
        consultar(url, _transporte(httpx.Response(200, text=HTML)))


def test_redirect_para_fora_da_sefaz_e_recusado() -> None:
    redirect = httpx.Response(302, headers={"Location": "http://169.254.169.254/"})
    with pytest.raises(UrlNaoPermitida):
        consultar(URL, _transporte(redirect))


def test_consulta_segue_redirect_interno() -> None:
    def responder(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("qrcode.aspx"):
            return httpx.Response(
                302, headers={"Location": "/servicos/nfce/danfe.aspx"}
            )
        return httpx.Response(200, text=HTML)

    assert consultar(URL, httpx.MockTransport(responder)).total == Decimal("522.68")


def test_erro_http_da_sefaz() -> None:
    with pytest.raises(ConsultaFalhou):
        consultar(URL, _transporte(httpx.Response(503)))


@pytest.mark.parametrize(
    ("erro", "status"),
    [(UrlNaoPermitida, 400), (ConsultaFalhou, 502), (LayoutNaoReconhecido, 422)],
)
def test_endpoint_mapeia_erros(
    monkeypatch: pytest.MonkeyPatch, erro: type[Exception], status: int
) -> None:
    def falhar(_: str) -> None:
        raise erro

    monkeypatch.setattr("ai.main.consultar", falhar)
    assert TestClient(app).post("/nfce/parse", json={"url": URL}).status_code == status


def test_endpoint_devolve_cupom(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ai.main.consultar", lambda _: parse_ba(HTML))
    corpo = TestClient(app).post("/nfce/parse", json={"url": URL}).json()
    assert corpo["total"] == "522.68"
    assert len(corpo["itens"]) == 46
