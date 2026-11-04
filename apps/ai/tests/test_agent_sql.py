import pytest

from ai.agent.sql import ConsultaRecusada, validar


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT categoria, sum(valor_total) FROM v_compras GROUP BY categoria",
        "select * from public.v_gasto_mensal where mes >= date '2026-01-01' limit 10",
        "WITH m AS (SELECT mercado, sum(valor_total) t FROM v_compras GROUP BY 1) SELECT * FROM m",
        "SELECT produto FROM v_preco_produto UNION SELECT produto FROM v_compras",
        "SELECT produto FROM v_compras WHERE produto ILIKE '%leite%' LIMIT 5",
        "SELECT date_trunc('month', data) AS mes, count(*) FROM v_compras GROUP BY 1",
    ],
)
def test_aceita_leitura_das_views(sql: str) -> None:
    assert validar(sql).upper().startswith(("SELECT", "WITH"))


@pytest.mark.parametrize(
    ("sql", "motivo"),
    [
        ("SELECT 1; DELETE FROM receipts", "mais_de_uma_instrucao"),
        ("DELETE FROM v_compras", "nao_e_select"),
        ("UPDATE receipts SET total = 0", "nao_e_select"),
        ("DROP VIEW v_compras", "nao_e_select"),
        ("SELECT * INTO copia FROM v_compras", "nao_e_somente_leitura"),
        ("SELECT * FROM v_compras FOR UPDATE", "nao_e_somente_leitura"),
        ("SELECT * FROM receipts", "tabela_nao_autorizada"),
        ("SELECT * FROM pg_catalog.pg_roles", "tabela_nao_autorizada"),
        ("SELECT * FROM pg_user", "tabela_nao_autorizada"),
        ("SELECT * FROM information_schema.tables", "tabela_nao_autorizada"),
        (
            "SELECT * FROM v_compras c JOIN llm_calls l ON true",
            "tabela_nao_autorizada",
        ),
        (
            "SELECT * FROM v_compras WHERE produto IN (SELECT url FROM import_errors)",
            "tabela_nao_autorizada",
        ),
        ("SELECT * FROM generate_series(1, 10)", "tabela_nao_autorizada"),
        ("SELECT pg_sleep(10)", "funcao_nao_autorizada"),
        ("SELECT pg_read_file('/etc/passwd')", "funcao_nao_autorizada"),
        ("SELECT current_setting('is_superuser')", "funcao_nao_autorizada"),
        (
            "SELECT query_to_xml('select * from receipts', true, true, '')",
            "funcao_nao_autorizada",
        ),
        ("SELECT * FROM v_compras LIMIT ALL", "limite_invalido"),
        ("SELECT * FROM v_compras LIMIT (SELECT 1000)", "limite_invalido"),
        ("isto não é sql", "sql_invalido"),
        ("", "mais_de_uma_instrucao"),
    ],
)
def test_recusa_o_que_nao_e_leitura_das_views(sql: str, motivo: str) -> None:
    with pytest.raises(ConsultaRecusada) as erro:
        validar(sql)
    assert erro.value.motivo == motivo


def test_cte_com_nome_de_tabela_nao_libera_a_tabela_real() -> None:
    # O nome da CTE vale só sem schema; public.receipts continua sendo a tabela.
    with pytest.raises(ConsultaRecusada):
        validar("WITH receipts AS (SELECT 1) SELECT * FROM public.receipts")
    assert validar("WITH receipts AS (SELECT 1 AS x) SELECT * FROM receipts")


@pytest.mark.parametrize(
    ("sql", "limite"),
    [
        ("SELECT * FROM v_compras", "LIMIT 500"),
        ("SELECT * FROM v_compras LIMIT 100000", "LIMIT 500"),
        ("SELECT * FROM v_compras LIMIT 20", "LIMIT 20"),
    ],
)
def test_limite_obrigatorio_de_ate_500(sql: str, limite: str) -> None:
    assert validar(sql).endswith(limite)
