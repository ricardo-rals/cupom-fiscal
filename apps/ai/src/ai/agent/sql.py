"""Validação da consulta gerada pelo LLM: a última barreira antes do banco."""

import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError

VIEWS = {"v_compras", "v_gasto_mensal", "v_preco_produto"}
LIMITE = 500
# Escrita, travas e SELECT INTO; o papel agent_ro também não deixa, isto é a segunda barreira.
PROIBIDOS = (
    exp.Into,
    exp.Lock,
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.Command,
    exp.Set,
)
# Funções que leem arquivos, executam SQL em texto, dormem ou mexem em configuração.
FUNCAO_PROIBIDA = re.compile(
    r"^(pg_|dblink|lo_|query_to|cursor_to|table_to|database_to|set_config|current_setting|txid_)",
    re.IGNORECASE,
)


class ConsultaRecusada(Exception):
    def __init__(self, motivo: str) -> None:
        super().__init__(motivo)
        self.motivo = motivo


def _nome_da_funcao(funcao: exp.Func) -> str:
    return funcao.name if isinstance(funcao, exp.Anonymous) else funcao.sql_name()


def validar(sql: str) -> str:
    """Devolve a consulta reescrita pelo parser, com LIMIT de no máximo 500."""
    try:
        arvores = [a for a in sqlglot.parse(sql, read="postgres") if a is not None]
    except (ParseError, TokenError):
        raise ConsultaRecusada("sql_invalido") from None
    if len(arvores) != 1:
        raise ConsultaRecusada("mais_de_uma_instrucao")
    raiz = arvores[0]
    if not isinstance(raiz, (exp.Select, exp.SetOperation)):
        raise ConsultaRecusada("nao_e_select")
    if any(isinstance(no, PROIBIDOS) for no in raiz.walk()):
        raise ConsultaRecusada("nao_e_somente_leitura")

    ctes = {cte.alias_or_name.lower() for cte in raiz.find_all(exp.CTE)}
    for tabela in raiz.find_all(exp.Table):
        nome = tabela.name.lower()
        if tabela.catalog or (tabela.db and tabela.db.lower() != "public"):
            raise ConsultaRecusada("tabela_nao_autorizada")
        # Função no FROM, como generate_series, também aparece como tabela.
        if not isinstance(tabela.this, exp.Identifier):
            raise ConsultaRecusada("tabela_nao_autorizada")
        if nome not in VIEWS and not (nome in ctes and not tabela.db):
            raise ConsultaRecusada("tabela_nao_autorizada")

    if any(FUNCAO_PROIBIDA.match(_nome_da_funcao(f)) for f in raiz.find_all(exp.Func)):
        raise ConsultaRecusada("funcao_nao_autorizada")

    limite = raiz.args.get("limit")
    if limite is None:
        raiz = raiz.limit(LIMITE)
    else:
        valor = limite.expression
        if not (isinstance(valor, exp.Literal) and valor.is_int):
            raise ConsultaRecusada("limite_invalido")
        if int(valor.name) > LIMITE:
            raiz = raiz.limit(LIMITE)
    return raiz.sql(dialect="postgres")
