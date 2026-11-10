"""Importação por foto: QR code primeiro; sem QR utilizável, leitura do texto.

O resultado do texto é sempre um rascunho: OCR erra, e o usuário revisa antes de confirmar.
"""

import base64
import binascii
import io
import json
import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import zxingcpp
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError

from ai.gemini import MODELO, criar_cliente, custo, gerar, trace_id_atual
from ai.normalize.schema import Chamada

TAMANHO_MAX = 8 * 1024 * 1024
PROMPT_VERSION = "foto_v1"
PROMPT = (Path(__file__).parent / "prompts" / f"{PROMPT_VERSION}.md").read_text(
    encoding="utf-8"
)
TIMEOUT_S = 90.0
CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
CNPJ = re.compile(r"(?<!\d)(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})(?!\d)")
CHAVE = re.compile(r"(?<!\d)((?:\d{4} ?){10}\d{4})(?!\d)")
DATA = re.compile(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)")
TOTAL = re.compile(
    r"(?:valor\s+a\s+pagar|valor\s+pago|valor\s+total|total)\s*(?:r\$)?\s*:?\s*"
    r"(\d{1,3}(?:\.\d{3})*,\d{2})",
    re.IGNORECASE,
)
UNIDADE = r"(UN|UND|KG|G|GR|L|LT|ML|PC|PCT|CX|DZ|FD|BD|SC)"
# Linha de item da DANFE NFC-e: [nº] [código] DESCRIÇÃO QTD UN [X] VL_UNIT VL_TOTAL
ITEM = re.compile(
    r"^(?:\d{1,3}\s+)?(?:(\d{4,14})\s+)?(.+?)\s+(\d+(?:[.,]\d+)?)\s*"
    + UNIDADE
    + r"\.?\s*[xX*]?\s*(\d+(?:[.,]\d+)?)\s+(\d+[.,]\d{2})\s*$",
    re.IGNORECASE,
)


class ImagemInvalida(Exception):
    pass


class OcrIndisponivel(Exception):
    pass


class ItemRascunho(BaseModel):
    codigo: str | None = None
    descricao_original: str = Field(min_length=1, max_length=500)
    quantidade: Decimal = Field(gt=0)
    unidade: str = Field(max_length=20)
    valor_unitario: Decimal = Field(ge=0)
    valor_total: Decimal = Field(ge=0)


class Rascunho(BaseModel):
    """Como o Cupom, mas tudo pode faltar: o usuário completa na revisão."""

    cnpj: str | None = None
    nome: str | None = None
    emitido_em: datetime | None = None
    chave_acesso: str | None = None
    itens: list[ItemRascunho] = []
    total: Decimal | None = None
    desconto: Decimal = Decimal(0)
    acrescimo: Decimal = Decimal(0)


class ResultadoFoto(BaseModel):
    tipo: str  # "url": QR de Sefaz suportada; "rascunho": texto lido
    url: str | None = None
    rascunho: Rascunho | None = None
    leitor: str | None = None  # "ia" ou "ocr"
    chamada: Chamada | None = None


def abrir(imagem_base64: str) -> Image.Image:
    try:
        bruto = base64.b64decode(imagem_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ImagemInvalida from None
    if not bruto or len(bruto) > TAMANHO_MAX:
        raise ImagemInvalida
    try:
        imagem = Image.open(io.BytesIO(bruto))
        imagem.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ImagemInvalida from None
    return ImageOps.exif_transpose(imagem).convert("RGB")


def ler_qr(imagem: Image.Image) -> str | None:
    for codigo in zxingcpp.read_barcodes(imagem, formats=zxingcpp.BarcodeFormat.QRCode):
        if codigo.text.lower().startswith(("http://", "https://")):
            return codigo.text.strip()
    return None


def chave_da_url(url: str) -> str | None:
    """O parâmetro p do QR da NFC-e começa com a chave de acesso."""
    p = parse_qs(urlsplit(url).query).get("p", [""])[0]
    digitos = re.match(r"\d{44}", p)
    return digitos.group(0) if digitos else None


def _numero(texto: str) -> Decimal:
    return Decimal(texto.replace(".", "").replace(",", ".") if "," in texto else texto)


def sem_cpf(texto: str) -> str:
    return " ".join(CPF.sub("", texto).split())


def _loja(linhas: list[str]) -> tuple[str | None, str | None]:
    """O CNPJ da loja está no cabeçalho; o nome é a primeira linha antes dele."""
    for posicao, linha in enumerate(linhas[:10]):
        achado = CNPJ.search(linha)
        if achado:
            nome = sem_cpf(linhas[0]) if posicao > 0 else None
            return re.sub(r"\D", "", achado.group(1)), nome or None
    return None, None


def _item(linha: str) -> ItemRascunho | None:
    achado = ITEM.match(linha)
    if not achado:
        return None
    codigo, descricao, quantidade, unidade, unitario, total = achado.groups()
    try:
        return ItemRascunho(
            codigo=codigo,
            descricao_original=sem_cpf(descricao)[:500],
            quantidade=_numero(quantidade),
            unidade=unidade.upper(),
            valor_unitario=_numero(unitario),
            valor_total=_numero(total),
        )
    except (InvalidOperation, ValidationError):
        return None


def _emissao(texto: str) -> datetime | None:
    data = DATA.search(texto)
    if not data:
        return None
    hora = data.group(2) if data.group(2).count(":") == 2 else f"{data.group(2)}:00"
    try:
        return datetime.strptime(
            f"{data.group(1)} {hora} -0300", "%d/%m/%Y %H:%M:%S %z"
        )
    except ValueError:
        return None


def interpretar(texto: str) -> Rascunho:
    """Lê os campos da DANFE NFC-e no texto do OCR. O que não casar fica de fora."""
    linhas = [" ".join(linha.split()) for linha in texto.splitlines()]
    linhas = [linha for linha in linhas if linha]
    cnpj, nome = _loja(linhas)
    chave = CHAVE.search(texto)
    totais = TOTAL.findall(texto)
    return Rascunho(
        cnpj=cnpj,
        nome=nome,
        emitido_em=_emissao(texto),
        chave_acesso=re.sub(r"\D", "", chave.group(1)) if chave else None,
        itens=[item for linha in linhas if (item := _item(linha))],
        total=_numero(totais[-1]) if totais else None,
    )


def ocr(imagem: Image.Image) -> str:
    import pytesseract  # o binário do Tesseract só existe na imagem Docker

    try:
        return pytesseract.image_to_string(ImageOps.grayscale(imagem), lang="por")
    except (pytesseract.TesseractNotFoundError, pytesseract.TesseractError):
        raise OcrIndisponivel from None


SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "cnpj": {"type": "STRING"},
        "nome": {"type": "STRING"},
        "emitido_em": {"type": "STRING"},
        "chave_acesso": {"type": "STRING"},
        "total": {"type": "NUMBER"},
        "desconto": {"type": "NUMBER"},
        "acrescimo": {"type": "NUMBER"},
        "itens": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "descricao_original": {"type": "STRING"},
                    "quantidade": {"type": "NUMBER"},
                    "unidade": {"type": "STRING"},
                    "valor_unitario": {"type": "NUMBER"},
                    "valor_total": {"type": "NUMBER"},
                },
                "required": [
                    "descricao_original",
                    "quantidade",
                    "unidade",
                    "valor_unitario",
                    "valor_total",
                ],
            },
        },
    },
    "required": ["cnpj", "nome", "emitido_em", "chave_acesso", "total", "itens"],
}


def _digitos(valor: object, tamanho: int) -> str | None:
    digitos = re.sub(r"\D", "", valor if isinstance(valor, str) else "")
    return digitos if len(digitos) == tamanho else None


def limpar(dados: dict) -> Rascunho:
    """A resposta do LLM passa pelas mesmas regras do OCR: só dígitos, sem CPF, vazio vira None."""
    try:
        emitido = datetime.fromisoformat(dados.get("emitido_em") or "")
    except (TypeError, ValueError):
        emitido = None
    itens = []
    for item in dados.get("itens") or []:
        try:
            itens.append(
                ItemRascunho(
                    descricao_original=sem_cpf(str(item.get("descricao_original")))[
                        :500
                    ],
                    quantidade=item.get("quantidade"),
                    unidade=str(item.get("unidade") or "UN")[:20],
                    valor_unitario=item.get("valor_unitario"),
                    valor_total=item.get("valor_total"),
                )
            )
        except (ValidationError, AttributeError):
            continue  # linha mal lida fica de fora; o usuário inclui na revisão
    return Rascunho(
        cnpj=_digitos(dados.get("cnpj"), 14),
        nome=sem_cpf(str(dados.get("nome") or "")) or None,
        emitido_em=emitido,
        chave_acesso=_digitos(dados.get("chave_acesso"), 44),
        itens=itens,
        total=dados.get("total"),
        desconto=dados.get("desconto") or 0,
        acrescimo=dados.get("acrescimo") or 0,
    )


def ler_com_ia(
    imagem: Image.Image, cliente: httpx.Client | None = None
) -> tuple[Rascunho, Chamada]:
    cliente = cliente or criar_cliente(TIMEOUT_S)
    jpeg = io.BytesIO()
    imagem.save(jpeg, format="JPEG", quality=90)
    anexo = {
        "inline_data": {
            "mime_type": "image/jpeg",
            "data": base64.b64encode(jpeg.getvalue()).decode(),
        }
    }
    inicio = time.monotonic()
    texto, entrada, saida = gerar(
        cliente, PROMPT, "Leia este cupom.", SCHEMA, anexos=[anexo]
    )
    chamada = Chamada(
        modelo=MODELO,
        tokens_in=entrada,
        tokens_out=saida,
        custo=f"{custo(entrada, saida):.6f}",
        latencia_ms=round((time.monotonic() - inicio) * 1000),
        trace_id=trace_id_atual(),
    )
    try:
        dados = json.loads(texto)
    except ValueError:
        dados = None
    # Resposta fora do formato: rascunho vazio, para o usuário preencher.
    return (limpar(dados) if isinstance(dados, dict) else Rascunho()), chamada
