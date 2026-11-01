from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ItemCupom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo: str | None
    descricao_original: str
    quantidade: Decimal
    unidade: str
    valor_unitario: Decimal
    valor_total: Decimal


# Lista fechada de campos: dados do consumidor não têm onde entrar.
class Cupom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cnpj: str = Field(pattern=r"^\d{14}$")
    nome: str
    cidade: str | None
    emitido_em: datetime
    chave_acesso: str = Field(pattern=r"^\d{44}$")
    itens: list[ItemCupom] = Field(min_length=1)
    total: Decimal
    desconto: Decimal = Decimal(0)
    acrescimo: Decimal = Decimal(0)
    pagamento: str | None
