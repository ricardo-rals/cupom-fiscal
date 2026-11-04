"""Pergunta em linguagem natural, SQL validado, execução como agent_ro e resposta curta."""

import json
import os
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import psycopg
from pydantic import BaseModel, Field

from ai.agent.sql import LIMITE, ConsultaRecusada, validar
from ai.gemini import MODELO, criar_cliente, custo, gerar
from ai.normalize.schema import CATEGORIAS, Chamada

PROMPT_VERSION = "v1"
_PROMPTS = Path(__file__).parent / "prompts"
PROMPT_SQL = (_PROMPTS / f"sql_{PROMPT_VERSION}.md").read_text(encoding="utf-8")
PROMPT_RESPOSTA = (_PROMPTS / f"resposta_{PROMPT_VERSION}.md").read_text(
    encoding="utf-8"
)
GRUPOS = (
    "Hortifrúti, Carnes e aves, Frios e laticínios, Mercearia, Padaria e matinais, "
    "Congelados, Doces e snacks, Bebidas, Limpeza, Higiene, Outros"
)
TIMEOUT_S = 40.0
TENTATIVAS_SQL = 2  # a segunda recebe o motivo da recusa da primeira
LINHAS_PARA_O_LLM = 50
FUSO = timezone(timedelta(hours=-3))  # America/Bahia, sem horário de verão

FORA_DO_DOMINIO = (
    "Só sei responder sobre as suas compras: quanto gastou por período, categoria ou mercado, "
    "quanto custa um produto e onde ele saiu mais barato."
)
SEM_CONSULTA = (
    "Não consegui montar uma consulta segura para essa pergunta. Tente reformular."
)
FALHA_NA_EXECUCAO = (
    "A consulta não pôde ser executada a tempo. Tente uma pergunta mais simples."
)

SCHEMA_SQL = {
    "type": "OBJECT",
    "properties": {"dominio": {"type": "BOOLEAN"}, "sql": {"type": "STRING"}},
    "required": ["dominio", "sql"],
}
SCHEMA_RESPOSTA = {
    "type": "OBJECT",
    "properties": {"resposta": {"type": "STRING"}},
    "required": ["resposta"],
}


class AgenteNaoConfigurado(Exception):
    pass


class SaidaSql(BaseModel):
    dominio: bool
    sql: str


class SaidaResposta(BaseModel):
    resposta: str = Field(min_length=1)


class RespostaAgente(BaseModel):
    resposta: str
    recusa: str | None = None
    sql: str | None = None
    colunas: list[str] = []
    linhas: list[list] = []
    chamadas: list[Chamada]
    prompt_version: str = PROMPT_VERSION


def _serializavel(valor: object) -> object:
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (date, datetime)):
        return valor.isoformat()
    return valor


def executar(sql: str) -> tuple[list[str], list[list]]:
    """Conecta como agent_ro: só lê as views, e o tempo máximo vale também aqui."""
    url = os.environ.get("AGENT_DATABASE_URL")
    if not url or not urlsplit(url).password:  # o compose monta a URL mesmo sem senha
        raise AgenteNaoConfigurado
    with psycopg.connect(
        url,
        connect_timeout=5,
        options="-c statement_timeout=3000 -c default_transaction_read_only=on",
    ) as conexao:
        conexao.read_only = True
        with conexao.cursor() as cursor:
            cursor.execute(sql)
            colunas = [c.name for c in cursor.description or []]
            linhas = cursor.fetchmany(LIMITE)
    return colunas, [[_serializavel(v) for v in linha] for linha in linhas]


def perguntar(
    pergunta: str,
    cliente: httpx.Client | None = None,
    executor: Callable[[str], tuple[list[str], list[list]]] = executar,
    hoje: date | None = None,
) -> RespostaAgente:
    cliente = cliente or criar_cliente(TIMEOUT_S)
    hoje = hoje or datetime.now(FUSO).date()
    chamadas: list[Chamada] = []

    def chamar(sistema: str, mensagem: str, schema: dict) -> str:
        inicio = time.monotonic()
        texto, entrada, saida = gerar(cliente, sistema, mensagem, schema)
        chamadas.append(
            Chamada(
                modelo=MODELO,
                tokens_in=entrada,
                tokens_out=saida,
                custo=f"{custo(entrada, saida):.6f}",
                latencia_ms=round((time.monotonic() - inicio) * 1000),
            )
        )
        return texto

    def recusar(texto: str, motivo: str, sql: str | None = None) -> RespostaAgente:
        return RespostaAgente(resposta=texto, recusa=motivo, sql=sql, chamadas=chamadas)

    mensagem = (
        f"Data de hoje: {hoje.isoformat()}.\n"
        f"Categorias: {', '.join(CATEGORIAS)}.\n"
        f"Grupos de categoria: {GRUPOS}.\n"
        f"Pergunta: {json.dumps(pergunta, ensure_ascii=False)}"
    )
    sql = None
    aviso = ""
    for _ in range(TENTATIVAS_SQL):
        try:
            saida = SaidaSql.model_validate_json(
                chamar(PROMPT_SQL, mensagem + aviso, SCHEMA_SQL)
            )
        except ValueError:
            aviso = "\n\nA resposta anterior veio fora do formato pedido."
            continue
        if not saida.dominio:
            return recusar(FORA_DO_DOMINIO, "fora_do_dominio")
        try:
            sql = validar(saida.sql)
            break
        except ConsultaRecusada as erro:
            aviso = (
                f"\n\nA consulta anterior foi recusada pelo validador: {erro.motivo}."
            )
    if sql is None:
        return recusar(SEM_CONSULTA, "consulta_invalida")

    try:
        colunas, linhas = executor(sql)
    except psycopg.Error:
        # Tempo esgotado ou permissão negada: a consulta aparece para o usuário entender.
        return recusar(FALHA_NA_EXECUCAO, "falha_na_execucao", sql)

    resultado = json.dumps(
        {
            "pergunta": pergunta,
            "colunas": colunas,
            "linhas": linhas[:LINHAS_PARA_O_LLM],
            "total_de_linhas": len(linhas),
        },
        ensure_ascii=False,
    )
    try:
        texto = SaidaResposta.model_validate_json(
            chamar(PROMPT_RESPOSTA, resultado, SCHEMA_RESPOSTA)
        ).resposta
    except ValueError:
        texto = "O resultado está na tabela abaixo."
    return RespostaAgente(
        resposta=texto, sql=sql, colunas=colunas, linhas=linhas, chamadas=chamadas
    )
