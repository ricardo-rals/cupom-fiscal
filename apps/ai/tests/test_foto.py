import base64
import io
from decimal import Decimal

import numpy as np
import pytest
import zxingcpp
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

from ai import main
from ai.nfce import foto
from ai.nfce.foto import chave_da_url, interpretar, limpar

CHAVE = "29261112345678000190650010000123451000012345"
URL_BA = f"http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p={CHAVE}|2|1|1|ABC"
URL_SP = f"https://www.nfce.fazenda.sp.gov.br/qrcode?p={CHAVE}|2|1|1|ABC"

TEXTO_OCR = """MERCADO BOM PRECO LTDA
CNPJ: 12.345.678/0001-90 IE: 123456
RUA DAS FLORES, 10, SALVADOR, BA
DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRONICA
001 7891234567890 ARROZ CAMIL T1 5KG 1 UN X 27,90 27,90
002 7890000000001 LEITE UHT ITALAC 1L 6 UN X 5,49 32,94
003 BANANA PRATA 1,250 KG X 6,50 8,13
Qtd. total de itens 3
Valor a pagar R$ 68,97
CONSUMIDOR CPF: 123.456.789-09
NFC-e n 12345 Serie 1 08/11/2026 10:15:32
Chave de acesso:
2926 1112 3456 7800 0190 6500 1000 0123 4510 0001 2345
"""


def _base64(imagem: Image.Image) -> str:
    saida = io.BytesIO()
    imagem.save(saida, format="PNG")
    return base64.b64encode(saida.getvalue()).decode()


def _foto_com_qr(url: str) -> str:
    codigo = zxingcpp.create_barcode(url, zxingcpp.BarcodeFormat.QRCode)
    qr = Image.fromarray(np.asarray(codigo.to_image(scale=6))).convert("RGB")
    return _base64(ImageOps.expand(qr, border=40, fill="white"))


def _foto_em_branco() -> str:
    return _base64(Image.new("RGB", (300, 400), "white"))


def test_le_os_campos_da_danfe_e_descarta_o_cpf() -> None:
    rascunho = interpretar(TEXTO_OCR)
    assert rascunho.cnpj == "12345678000190"
    assert rascunho.nome == "MERCADO BOM PRECO LTDA"
    assert rascunho.chave_acesso == CHAVE
    assert rascunho.total == Decimal("68.97")
    assert rascunho.emitido_em.isoformat() == "2026-11-08T10:15:32-03:00"
    assert [
        (i.descricao_original, i.quantidade, i.unidade, i.valor_total)
        for i in rascunho.itens
    ] == [
        ("ARROZ CAMIL T1 5KG", Decimal(1), "UN", Decimal("27.90")),
        ("LEITE UHT ITALAC 1L", Decimal(6), "UN", Decimal("32.94")),
        ("BANANA PRATA", Decimal("1.250"), "KG", Decimal("8.13")),
    ]
    assert "123.456.789-09" not in rascunho.model_dump_json()


def test_chave_sai_do_parametro_p_do_qr() -> None:
    assert chave_da_url(URL_SP) == CHAVE
    assert chave_da_url("https://x/qrcode?p=123") is None


def test_resposta_do_llm_passa_pelas_mesmas_regras() -> None:
    rascunho = limpar(
        {
            "cnpj": "12.345.678/0001-90",
            "nome": "LOJA 123.456.789-09",
            "emitido_em": "2026-11-08T10:15:32-03:00",
            "chave_acesso": "curta",
            "total": 10,
            "itens": [
                {
                    "descricao_original": "CAFE 500G",
                    "quantidade": 1,
                    "unidade": "UN",
                    "valor_unitario": 10,
                    "valor_total": 10,
                },
                {
                    "descricao_original": "SEM QUANTIDADE",
                    "quantidade": 0,
                    "unidade": "UN",
                    "valor_unitario": 1,
                    "valor_total": 1,
                },
                "lixo",
            ],
        }
    )
    assert rascunho.cnpj == "12345678000190"
    assert rascunho.nome == "LOJA"
    assert rascunho.chave_acesso is None
    assert [i.descricao_original for i in rascunho.itens] == ["CAFE 500G"]


def test_qr_de_sefaz_suportada_volta_como_url() -> None:
    resposta = TestClient(main.app).post(
        "/nfce/foto", json={"imagem": _foto_com_qr(URL_BA)}
    )
    assert resposta.status_code == 200
    assert resposta.json() == {
        "tipo": "url",
        "url": URL_BA,
        "rascunho": None,
        "leitor": None,
        "chamada": None,
    }


def test_qr_de_outro_estado_vira_rascunho_com_a_chave(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main, "ocr", lambda _: "MERCADO SP\nCNPJ 12.345.678/0001-90\n")
    resposta = TestClient(main.app).post(
        "/nfce/foto", json={"imagem": _foto_com_qr(URL_SP)}
    )
    corpo = resposta.json()
    assert corpo["tipo"] == "rascunho"
    assert corpo["leitor"] == "ocr"
    assert corpo["rascunho"]["chave_acesso"] == CHAVE


def test_com_ia_indisponivel_o_ocr_assume(monkeypatch: pytest.MonkeyPatch) -> None:
    def sem_chave(_):
        raise main.LlmNaoConfigurado

    monkeypatch.setattr(main, "ler_com_ia", sem_chave)
    monkeypatch.setattr(main, "ocr", lambda _: TEXTO_OCR)
    resposta = TestClient(main.app).post(
        "/nfce/foto", json={"imagem": _foto_em_branco(), "usar_ia": True}
    )
    corpo = resposta.json()
    assert corpo["leitor"] == "ocr"
    assert len(corpo["rascunho"]["itens"]) == 3


def test_sem_tesseract_responde_503(monkeypatch: pytest.MonkeyPatch) -> None:
    def quebrado(_):
        raise foto.OcrIndisponivel

    monkeypatch.setattr(main, "ocr", quebrado)
    resposta = TestClient(main.app).post(
        "/nfce/foto", json={"imagem": _foto_em_branco()}
    )
    assert resposta.status_code == 503


@pytest.mark.parametrize(
    "imagem", ["não é base64", base64.b64encode(b"texto").decode(), ""]
)
def test_imagem_invalida_responde_400(imagem: str) -> None:
    resposta = TestClient(main.app).post("/nfce/foto", json={"imagem": imagem})
    assert resposta.status_code == 400
