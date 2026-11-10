"""Normalização sem LLM: rápida, de graça e sem rede, com menos precisão.

- Item quase igual a um exemplo conhecido (correção do usuário ou treino) copia o exemplo.
- Senão, a categoria vem de uma regressão logística sobre TF-IDF da descrição, treinada com
  os exemplos e com o vocabulário de `lexico.py`; a confiança é a probabilidade do modelo.
- Conteúdo e unidade saem da própria descrição ("400G" vira 0,4 kg); marca, de uma marca
  conhecida que apareça nela. O nome do produto é a descrição limpa: abreviações como
  "QJ MUSS" continuam abreviadas, o que só o LLM resolve.
"""

import csv
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline, make_pipeline, make_union

from ai.normalize.lexico import LEXICO
from ai.normalize.schema import Correcao, ItemEntrada, ItemNormalizado

TREINO = Path(__file__).parent / "treino.csv"
QUASE_IGUAL = 92  # fuzz.ratio a partir do qual o item é o mesmo produto do exemplo
C_REGRESSAO = 30  # escolhido por validação cruzada no conjunto de avaliação
CONTEUDO = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grs|ml|l|lt|lts|litros?)\b")
PARA_PADRAO = {
    "kg": (1, "kg"),
    "g": (0.001, "kg"),
    "gr": (0.001, "kg"),
    "grs": (0.001, "kg"),
    "ml": (0.001, "l"),
    "l": (1, "l"),
    "lt": (1, "l"),
    "lts": (1, "l"),
    "litro": (1, "l"),
    "litros": (1, "l"),
}


def simplificar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFD", texto)
    return " ".join(
        "".join(c for c in sem_acento if not unicodedata.combining(c)).lower().split()
    )


@lru_cache(maxsize=1)
def exemplos_de_treino() -> tuple[Correcao, ...]:
    with TREINO.open(encoding="utf-8") as arquivo:
        return tuple(
            Correcao(
                descricao_original=linha["descricao_original"],
                produto=linha["produto"],
                marca=linha["marca"],
                conteudo=float(linha["conteudo"]),
                unidade_padrao=linha["unidade_padrao"],
                categoria=linha["categoria"],
            )
            for linha in csv.DictReader(arquivo, delimiter=";")
        )


def treinar(exemplos: tuple[Correcao, ...]) -> Pipeline:
    textos = [simplificar(e.descricao_original) for e in exemplos]
    rotulos = [e.categoria for e in exemplos]
    for categoria, termos in LEXICO.items():
        textos += [simplificar(t) for t in termos]
        rotulos += [categoria] * len(termos)
    vetores = make_union(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True),
        TfidfVectorizer(analyzer="word"),
    )
    modelo = make_pipeline(vetores, LogisticRegression(C=C_REGRESSAO, max_iter=2000))
    return modelo.fit(textos, rotulos)


# ponytail: retreina quando as correções mudam (~1 s com milhares de exemplos);
# guardar o modelo por usuário se isso pesar.
@lru_cache(maxsize=4)
def _modelo(exemplos: tuple[Correcao, ...]) -> Pipeline:
    return treinar(exemplos)


def conteudo_e_unidade(descricao: str, unidade: str) -> tuple[float, str]:
    """O último tamanho citado vale ("2X200G 400G" é 400 g); sem tamanho, granel ou unidade."""
    achados = CONTEUDO.findall(simplificar(descricao))
    for numero, sigla in reversed(achados):
        valor = float(numero.replace(",", "."))
        if valor > 0:
            fator, padrao = PARA_PADRAO[sigla]
            return round(valor * fator, 4), padrao
    return 1.0, "kg" if simplificar(unidade) == "kg" else "un"


def _marca(descricao: str, marcas: dict[str, str]) -> str:
    texto = f" {simplificar(descricao)} "
    # A marca mais longa ganha: "casa suica" antes de "suica".
    for simples in sorted(marcas, key=len, reverse=True):
        if f" {simples} " in texto:
            return marcas[simples]
    return ""


def _nome(descricao: str) -> str:
    sem_tamanho = CONTEUDO.sub(" ", simplificar(descricao))
    palavras = [p for p in sem_tamanho.split() if not p.isdigit()]
    return " ".join(palavras) or simplificar(descricao) or "item"


def normalizar_local(
    itens: list[ItemEntrada],
    correcoes: list[Correcao],
    base: tuple[Correcao, ...] | None = None,
) -> list[ItemNormalizado]:
    # Correção do usuário vem antes: no empate de semelhança, ela vence o treino.
    exemplos = tuple(correcoes) + (exemplos_de_treino() if base is None else base)
    modelo = _modelo(exemplos)
    descricoes = [simplificar(e.descricao_original) for e in exemplos]
    marcas = {simplificar(e.marca): e.marca for e in exemplos if e.marca.strip()}
    categorias = modelo.predict_proba([simplificar(i.descricao) for i in itens])

    saida = []
    for item, probabilidades in zip(itens, categorias, strict=True):
        conteudo, unidade_padrao = conteudo_e_unidade(item.descricao, item.unidade)
        parecido = process.extractOne(
            simplificar(item.descricao), descricoes, scorer=fuzz.ratio
        )
        if parecido and parecido[1] >= QUASE_IGUAL:
            exemplo = exemplos[parecido[2]]
            tem_tamanho = CONTEUDO.search(simplificar(item.descricao))
            saida.append(
                ItemNormalizado(
                    id=item.id,
                    produto=exemplo.produto,
                    marca=exemplo.marca,
                    conteudo=conteudo if tem_tamanho else exemplo.conteudo,
                    unidade_padrao=(
                        unidade_padrao if tem_tamanho else exemplo.unidade_padrao
                    ),
                    categoria=exemplo.categoria,
                    confianca=round(parecido[1] / 100, 3),
                )
            )
            continue

        melhor = probabilidades.argmax()
        saida.append(
            ItemNormalizado(
                id=item.id,
                produto=_nome(item.descricao),
                marca=_marca(item.descricao, marcas),
                conteudo=conteudo,
                unidade_padrao=unidade_padrao,
                categoria=modelo.classes_[melhor],
                confianca=round(float(probabilidades[melhor]), 3),
            )
        )
    return saida
