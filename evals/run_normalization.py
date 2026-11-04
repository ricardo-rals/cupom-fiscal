"""Avalia a normalização contra o conjunto congelado e atualiza docs/results.md.

Chama o LLM de verdade e gasta dinheiro, por isso fica fora da CI. Rode dentro de apps/ai,
com GEMINI_API_KEY no ambiente:

    uv run python ../../evals/run_normalization.py --cambio 5.40

As respostas ficam salvas por lote: repetir o comando depois de uma queda continua de onde
parou, sem pagar de novo. Nenhum exemplo do conjunto entra no prompt (`correcoes` vazio).
"""

import argparse
import csv
import json
import math
import time
import unicodedata
from datetime import date
from pathlib import Path

from rapidfuzz import fuzz

from ai.gemini import MODELO, LlmIndisponivel
from ai.normalize.llm import PROMPT_VERSION, normalizar
from ai.normalize.schema import ItemEntrada

RAIZ = Path(__file__).parents[1]
GOLD = RAIZ / "evals/data/normalization_gold.csv"
PREDICOES = RAIZ / "docs/normalization_predicoes.json"
RESULTADOS = RAIZ / "docs/results.md"
INICIO = "<!-- normalizacao:inicio -->"
FIM = "<!-- normalizacao:fim -->"

LOTE = 20  # o mesmo tamanho usado pela api
ITENS_POR_CUPOM = 30  # referência da meta de custo do spec
LIMIAR = 0.8  # padrão de NORMALIZACAO_LIMIAR
SIMILARIDADE_PRODUTO = 80  # abaixo disso o nome é outro produto; publicado no relatório
TENTATIVAS_LOTE = 6
ESPERA_S = 60


def simplificar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFD", texto)
    return " ".join(
        "".join(c for c in sem_acento if not unicodedata.combining(c)).lower().split()
    )


def pontuar(esperado: dict, previsto: dict | None) -> dict[str, bool]:
    """Sem resposta do modelo, o item conta como erro em tudo."""
    if previsto is None:
        return dict.fromkeys(
            [
                "categoria",
                "produto",
                "produto_exato",
                "unidade",
                "produto_e_unidade",
                "conteudo",
                "marca",
            ],
            False,
        )
    a, b = simplificar(esperado["produto"]), simplificar(previsto["produto"])
    produto = fuzz.token_sort_ratio(a, b) >= SIMILARIDADE_PRODUTO
    unidade = esperado["unidade_padrao"] == previsto["unidade_padrao"]
    return {
        "categoria": esperado["categoria"] == previsto["categoria"],
        "produto": produto,
        "produto_exato": a == b,
        "unidade": unidade,
        "produto_e_unidade": produto and unidade,
        "conteudo": math.isclose(
            float(esperado["conteudo"]), previsto["conteudo"], rel_tol=0.01
        ),
        "marca": simplificar(esperado["marca"]) == simplificar(previsto["marca"]),
    }


def carregar_gold() -> list[dict]:
    with GOLD.open(encoding="utf-8-sig", newline="") as arquivo:
        return list(csv.DictReader(arquivo, delimiter=";"))


def carregar_lotes() -> dict:
    if not PREDICOES.exists():
        return {}
    salvo = json.loads(PREDICOES.read_text(encoding="utf-8"))
    # Outro modelo ou prompt é outra rodada: não aproveita resposta antiga.
    if (salvo["modelo"], salvo["prompt_version"]) != (MODELO, PROMPT_VERSION):
        return {}
    return salvo["lotes"]


def salvar_lotes(lotes: dict) -> None:
    PREDICOES.parent.mkdir(exist_ok=True)
    corpo = {"modelo": MODELO, "prompt_version": PROMPT_VERSION, "lotes": lotes}
    PREDICOES.write_text(
        json.dumps(corpo, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def rodar(gold: list[dict]) -> dict:
    lotes = carregar_lotes()
    for inicio in range(0, len(gold), LOTE):
        if str(inicio) in lotes:
            continue
        entrada = [
            ItemEntrada(id=i, descricao=g["descricao_original"], unidade=g["unidade"])
            for i, g in enumerate(gold[inicio : inicio + LOTE], start=inicio)
        ]
        for tentativa in range(1, TENTATIVAS_LOTE + 1):
            try:
                resposta = normalizar(entrada, [])
                break
            except LlmIndisponivel as erro:
                print(f"lote {inicio}: tentativa {tentativa}, {erro}")
                if tentativa == TENTATIVAS_LOTE:
                    raise SystemExit(
                        "LLM indisponível. Rode de novo para continuar."
                    ) from None
                time.sleep(ESPERA_S)
        lotes[str(inicio)] = json.loads(resposta.model_dump_json())
        salvar_lotes(lotes)
        print(f"lote {inicio}: {len(resposta.itens)} de {len(entrada)} itens")
    return lotes


def fatia(linhas: list[dict]) -> dict:
    return {
        metrica: sum(linha["acertos"][metrica] for linha in linhas) / len(linhas)
        for metrica in linhas[0]["acertos"]
    }


def relatorio(gold: list[dict], lotes: dict, cambio: float | None) -> str:
    previstos = {item["id"]: item for lote in lotes.values() for item in lote["itens"]}
    linhas = [
        {**g, "previsto": previstos.get(i), "acertos": pontuar(g, previstos.get(i))}
        for i, g in enumerate(gold)
    ]
    grupos = {
        "Todos": linhas,
        "Reais": [x for x in linhas if x["origem"] == "real"],
        "Reais sem dúvida de rótulo": [
            x for x in linhas if x["origem"] == "real" and not x["duvida"]
        ],
        "Sintéticos": [x for x in linhas if x["origem"] == "sintetico"],
    }
    metricas = [
        ("categoria", "Categoria", "90%"),
        ("produto_e_unidade", "Produto e unidade", "80%"),
        ("produto", "Produto, similaridade", ""),
        ("produto_exato", "Produto, texto igual", ""),
        ("unidade", "Unidade padrão", ""),
        ("conteudo", "Conteúdo, tolerância de 1%", ""),
        ("marca", "Marca", ""),
    ]

    chamadas = [lote["chamada"] for lote in lotes.values()]
    custo = sum(float(c["custo"]) for c in chamadas)
    tokens_in = sum(c["tokens_in"] for c in chamadas)
    tokens_out = sum(c["tokens_out"] for c in chamadas)
    latencia = sum(c["latencia_ms"] for c in chamadas)
    custo_cupom = custo / len(gold) * ITENS_POR_CUPOM
    em_reais = (
        f"R$ {custo_cupom * cambio:.4f}, a US$ 1 = R$ {cambio:.4f} (meta: R$ 0,05)"
        if cambio
        else "sem câmbio informado"
    )

    com_resposta = [x for x in linhas if x["previsto"]]
    confiantes = [x for x in com_resposta if x["previsto"]["confianca"] >= LIMIAR]
    duvidosos = [x for x in com_resposta if x["previsto"]["confianca"] < LIMIAR]
    taxa = lambda grupo: f"{fatia(grupo)['categoria']:.1%}" if grupo else "sem itens"

    partes = [
        "## Normalização",
        "",
        f"- Data: {date.today().isoformat()}",
        f"- Modelo: `{MODELO}`. Prompt: `{PROMPT_VERSION}`. Sem exemplos de correção e com cache frio.",
        (
            f"- Conjunto: {len(gold)} itens, {len(grupos['Reais'])} reais e "
            f"{len(grupos['Sintéticos'])} sintéticos. Respostas em `docs/normalization_predicoes.json`."
        ),
        f"- Sem resposta válida: {len(linhas) - len(com_resposta)} itens, contados como erro.",
        "",
        "| Métrica | Meta | "
        + " | ".join(f"{k} ({len(v)})" for k, v in grupos.items())
        + " |",
        "| --- | --- | " + " | ".join("---" for _ in grupos) + " |",
    ]
    resultados = {nome: fatia(grupo) for nome, grupo in grupos.items()}
    for chave, nome, meta in metricas:
        valores = " | ".join(f"{resultados[g][chave]:.1%}" for g in grupos)
        partes.append(f"| {nome} | {meta or '-'} | {valores} |")

    partes += [
        "",
        "### Custo e latência",
        "",
        (
            f"- Total da rodada: US$ {custo:.4f} em {len(chamadas)} lotes, com {tokens_in} tokens de "
            f"entrada e {tokens_out} de saída. O preço usado é o da API paga."
        ),
        f"- Por cupom de {ITENS_POR_CUPOM} itens: US$ {custo_cupom:.4f}, ou {em_reais}.",
        (
            f"- Latência por lote de {LOTE}: média de {latencia / len(chamadas) / 1000:.1f} s. "
            "Rejeições e novas tentativas estão incluídas; esperas por erro 503 não."
        ),
        "",
        "### Confiança",
        "",
        f"- Abaixo do limiar de {LIMIAR} (iriam para revisão): {len(duvidosos)} de {len(com_resposta)}.",
        f"- Acerto de categoria acima do limiar: {taxa(confiantes)}. Abaixo: {taxa(duvidosos)}.",
        "",
        "### Como ler estes números",
        "",
        (
            "- Os rótulos foram escritos pelo Claude, e o autor do projeto os aceitou sem revisão item "
            "a item. O rotulador já tinha visto respostas do Gemini para parte dos itens. "
            "Trate os números como estimativa, não como medida independente."
        ),
        (
            "- Só a linha de reais mede compras de verdade. Os sintéticos completam os 200 itens e "
            "foram inventados no estilo dos cupons."
        ),
        (
            "- O prompt v2 fixa saco de lixo em `Limpeza da casa`, decisão tomada olhando esses itens: "
            "eles não são um teste independente."
        ),
        (
            f"- Produto conta como certo com similaridade de pelo menos {SIMILARIDADE_PRODUTO} "
            "(`token_sort_ratio`, sem acento nem caixa). Nomes equivalentes com palavras diferentes contam como erro."
        ),
        "",
        "### Erros de categoria",
        "",
    ]
    erros = [x for x in linhas if not x["acertos"]["categoria"]]
    if erros:
        partes += [
            "| Descrição | Origem | Esperado | Previsto | Confiança |",
            "| --- | --- | --- | --- | --- |",
        ]
        for x in erros:
            previsto = x["previsto"]
            partes.append(
                f"| {x['descricao_original']} | {x['origem']} | {x['categoria']} | "
                f"{previsto['categoria'] if previsto else 'sem resposta'} | "
                f"{previsto['confianca'] if previsto else '-'} |"
            )
    else:
        partes.append("Nenhum.")
    return "\n".join(partes)


def gravar(secao: str) -> None:
    bloco = f"{INICIO}\n{secao}\n{FIM}"
    atual = (
        RESULTADOS.read_text(encoding="utf-8")
        if RESULTADOS.exists()
        else f"# Resultados das avaliações\n\n{INICIO}\n{FIM}\n"
    )
    antes, _, resto = atual.partition(INICIO)
    _, _, depois = resto.partition(FIM)
    RESULTADOS.write_text(antes + bloco + depois, encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cambio", type=float, help="reais por dólar, para a meta de custo"
    )
    gold = carregar_gold()
    args = parser.parse_args()
    gravar(relatorio(gold, rodar(gold), args.cambio))
    print(f"relatório em {RESULTADOS}")


if __name__ == "__main__":
    main()
