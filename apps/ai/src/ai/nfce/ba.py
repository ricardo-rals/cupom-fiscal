import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from selectolax.lexbor import LexborHTMLParser, LexborNode

from ai.nfce.schema import Cupom, ItemCupom


class LayoutNaoReconhecido(Exception):
    pass


def _texto(node: LexborNode | None) -> str:
    if node is None:
        raise ValueError("elemento ausente")
    return " ".join(node.text().split())


def _numero(texto: str) -> Decimal:
    return Decimal(texto.replace(".", "").replace(",", "."))


def _depois_do_rotulo(node: LexborNode, seletor: str) -> str:
    return _texto(node.css_first(seletor)).split(":", 1)[1].strip()


def _item(linha: LexborNode) -> ItemCupom:
    codigo = re.search(r"Código:\s*([^)]+)\)", _texto(linha.css_first(".RCod")))
    return ItemCupom(
        codigo=codigo.group(1).strip() if codigo else None,
        descricao_original=_texto(linha.css_first(".txtTit")),
        quantidade=_numero(_depois_do_rotulo(linha, ".Rqtd")),
        unidade=_depois_do_rotulo(linha, ".RUN"),
        valor_unitario=_numero(_depois_do_rotulo(linha, ".RvlUnit")),
        valor_total=_numero(_texto(linha.css_first(".valor"))),
    )


def _valor_do_rotulo(linhas: dict[str, Decimal], rotulo: str) -> Decimal | None:
    return next((v for k, v in linhas.items() if rotulo in k.lower()), None)


def parse_ba(html: str) -> Cupom:
    """Lê só os campos do Cupom; o bloco do consumidor nunca é consultado."""
    try:
        doc = LexborHTMLParser(html)
        itens = [_item(tr) for tr in doc.css("#tabResult tr")]

        linhas: dict[str, Decimal] = {}
        for linha in doc.css("#totalNota > div"):
            rotulo, valor = linha.css_first("label"), linha.css_first(".totalNumb")
            if (
                rotulo
                and valor
                and "tx" not in (rotulo.attributes.get("class") or "").split()
            ):
                try:
                    linhas[_texto(rotulo)] = _numero(_texto(valor))
                except InvalidOperation:
                    pass  # cabeçalho "Forma de pagamento / Valor pago"

        total = _valor_do_rotulo(linhas, "valor a pagar")
        qtd = _valor_do_rotulo(linhas, "qtd. total de itens")
        if total is None or qtd != len(itens):
            raise ValueError("totais incoerentes")

        emissao = re.search(
            r"Emissão:\s*(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}[-+]\d{2}:\d{2})",
            _texto(doc.css_first("#infos")),
        )
        if emissao is None:
            raise ValueError("emissão ausente")

        cabecalho = doc.css_first(".txtCenter")
        blocos = cabecalho.css(".text") if cabecalho else []
        endereco = [p.strip() for p in _texto(blocos[1]).split(",") if p.strip()]
        pagamentos = [_texto(label) for label in doc.css("#totalNota label.tx")]

        return Cupom(
            cnpj=re.sub(r"\D", "", _texto(blocos[0])),
            nome=_texto(doc.css_first("#u20")),
            cidade=endereco[-2] if len(endereco) >= 2 else None,
            emitido_em=datetime.strptime(emissao.group(1), "%d/%m/%Y %H:%M:%S%z"),
            chave_acesso=re.sub(r"\D", "", _texto(doc.css_first(".chave"))),
            itens=itens,
            total=total,
            desconto=_valor_do_rotulo(linhas, "desconto") or Decimal(0),
            # ponytail: rótulo não visto em cupom real; confirmar com um cupom com acréscimo.
            acrescimo=_valor_do_rotulo(linhas, "acréscimo") or Decimal(0),
            pagamento=", ".join(pagamentos) or None,
        )
    except (ValueError, IndexError, InvalidOperation) as erro:
        # Sem o conteúdo da página na mensagem: ela pode ter CPF.
        raise LayoutNaoReconhecido(type(erro).__name__) from None
