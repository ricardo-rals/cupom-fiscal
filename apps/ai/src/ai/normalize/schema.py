from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Mesma lista da migration de taxonomia da api; um teste garante que não divergem.
CATEGORIAS = (
    "Frutas",
    "Legumes e verduras",
    "Carne bovina",
    "Aves",
    "Carne suína",
    "Peixes e frutos do mar",
    "Leite",
    "Queijos",
    "Frios e embutidos",
    "Iogurtes e bebidas lácteas",
    "Manteiga, requeijão e creme de leite",
    "Ovos",
    "Arroz e feijão",
    "Massas",
    "Cereais, grãos e farinhas",
    "Açúcar e adoçantes",
    "Óleos, azeites e vinagres",
    "Molhos e temperos",
    "Enlatados e conservas",
    "Café e chá",
    "Pães",
    "Bolos e panetones",
    "Biscoitos",
    "Achocolatados e matinais",
    "Pizzas e pratos prontos",
    "Sorvetes",
    "Chocolates e doces",
    "Salgadinhos",
    "Água",
    "Refrigerantes",
    "Sucos e refrescos",
    "Bebidas alcoólicas",
    "Limpeza da casa",
    "Lavagem de roupa",
    "Louça",
    "Papéis e descartáveis",
    "Banho e cabelo",
    "Higiene bucal",
    "Desodorantes",
    "Absorventes e papel higiênico",
    "Bebê",
    "Pet",
    "Diversos",
)

Categoria = Literal[*CATEGORIAS]
UnidadePadrao = Literal["kg", "l", "un"]


class ItemEntrada(BaseModel):
    id: int
    descricao: str = Field(max_length=500)
    unidade: str = Field(max_length=20)


class Correcao(BaseModel):
    model_config = ConfigDict(frozen=True)  # entra na chave do cache do modelo local

    descricao_original: str
    produto: str
    marca: str
    conteudo: float
    unidade_padrao: UnidadePadrao
    categoria: str


class ItemNormalizado(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    produto: str = Field(min_length=1)
    marca: str
    conteudo: float = Field(gt=0)
    unidade_padrao: UnidadePadrao
    categoria: Categoria
    confianca: float = Field(ge=0, le=1)


class SaidaLlm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    itens: list[ItemNormalizado]


class Chamada(BaseModel):
    modelo: str
    tokens_in: int
    tokens_out: int
    custo: str
    latencia_ms: int
    trace_id: str | None = None


class NormalizeRequest(BaseModel):
    itens: list[ItemEntrada] = Field(min_length=1, max_length=20)
    correcoes: list[Correcao] = Field(default=[], max_length=5000)


class NormalizeResponse(BaseModel):
    """Sem `itens` quando todas as tentativas falharam; os tokens gastos vêm em `chamada`."""

    itens: list[ItemNormalizado]
    chamada: Chamada
    prompt_version: str
