import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ai.main import app
from ai.normalize.lexico import LEXICO
from ai.normalize.local import conteudo_e_unidade, normalizar_local
from ai.normalize.schema import CATEGORIAS, Correcao, ItemEntrada

GOLD = Path(__file__).parents[3] / "evals/data/normalization_gold.csv"
TREINO = Path(__file__).parents[1] / "src/ai/normalize/treino.csv"


def _item(descricao: str, unidade: str = "UN", id: int = 1) -> ItemEntrada:
    return ItemEntrada(id=id, descricao=descricao, unidade=unidade)


@pytest.mark.parametrize(
    ("descricao", "unidade", "esperado"),
    [
        ("PANETTONE CASA SUICA 400G GOTAS", "UN", (0.4, "kg")),
        ("REFRIG COCA COLA PET 2L", "UN", (2.0, "l")),
        ("DET LIQ YPE NEUTRO 500ML", "UN", (0.5, "l")),
        ("LEITE UHT 1,5 LT", "UN", (1.5, "l")),
        ("BISC 2X200G 400G", "UN", (0.4, "kg")),
        ("TOMATE", "KG", (1.0, "kg")),
        ("ESPONJA DUPLA FACE", "UN", (1.0, "un")),
    ],
)
def test_conteudo_sai_da_descricao(descricao, unidade, esperado) -> None:
    assert conteudo_e_unidade(descricao, unidade) == esperado


def test_categoria_obvia_e_marca_conhecida() -> None:
    (refri,) = normalizar_local([_item("REFRIG COCA COLA PET 2L")], [])
    assert refri.categoria == "Refrigerantes"
    assert (refri.conteudo, refri.unidade_padrao) == (2.0, "l")
    assert 0 < refri.confianca <= 1


def test_correcao_do_usuario_quase_igual_e_copiada() -> None:
    correcao = Correcao(
        descricao_original="QJ LAC GLORIA MUSS FAT KG",
        produto="queijo mussarela fatiado",
        marca="Lac Glória",
        conteudo=1,
        unidade_padrao="kg",
        categoria="Queijos",
    )
    (item,) = normalizar_local([_item("QJ LAC GLORIA MUSS FAT kg", "KG")], [correcao])
    assert item.produto == "queijo mussarela fatiado"
    assert item.marca == "Lac Glória"
    assert item.confianca >= 0.92


def test_correcao_ensina_categoria_que_o_modelo_nao_sabia() -> None:
    estranho = _item("XPTO ZZYZX 300G")
    correcoes = [
        Correcao(
            descricao_original=f"XPTO ZZYZX SABOR {n}",
            produto="xpto",
            marca="",
            conteudo=0.3,
            unidade_padrao="kg",
            categoria="Pet",
        )
        for n in range(5)
    ]
    (item,) = normalizar_local([estranho], correcoes)
    assert item.categoria == "Pet"


def test_vocabulario_cobre_exatamente_as_categorias() -> None:
    assert set(LEXICO) == set(CATEGORIAS)


def test_treino_e_copia_do_conjunto_rotulado() -> None:
    def ler(caminho: Path) -> list[tuple]:
        with caminho.open(encoding="utf-8-sig") as arquivo:
            return [
                (r["descricao_original"], r["categoria"], r["produto"])
                for r in csv.DictReader(arquivo, delimiter=";")
            ]

    assert ler(TREINO) == ler(GOLD)


def test_endpoint_devolve_todos_os_itens() -> None:
    resposta = TestClient(app).post(
        "/normalize/local",
        json={
            "itens": [
                {"id": 7, "descricao": "ARROZ CAMIL T1 5KG", "unidade": "UN"},
                {"id": 8, "descricao": "SABAO PO OMO 800G", "unidade": "UN"},
            ]
        },
    )
    assert resposta.status_code == 200
    assert [i["id"] for i in resposta.json()["itens"]] == [7, 8]
