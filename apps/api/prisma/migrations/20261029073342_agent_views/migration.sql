-- Previsão é de um produto ou de uma categoria, nunca dos dois.
ALTER TABLE forecasts ADD CONSTRAINT forecasts_alvo_check
  CHECK ((product_id IS NULL) <> (category_id IS NULL));

-- Views do agente de perguntas. Só entram itens de cupons normalizados com produto resolvido.
CREATE VIEW v_compras AS
SELECT
  (r.emitido_em AT TIME ZONE 'America/Bahia')::date        AS data,
  s.nome                                                    AS mercado,
  p.nome_canonico                                           AS produto,
  p.marca,
  c.nome                                                    AS categoria,
  cp.nome                                                   AS categoria_pai,
  i.quantidade,
  i.valor_total - i.desconto                                AS valor_total,
  round((i.valor_total - i.desconto) / i.quantidade / p.conteudo, 4) AS preco_unidade_padrao,
  p.unidade_padrao
FROM receipt_items i
JOIN receipts r              ON r.id = i.receipt_id
JOIN stores s                ON s.id = r.store_id
JOIN item_normalizations n   ON n.receipt_item_id = i.id
JOIN products p              ON p.id = n.product_id
JOIN categories c            ON c.id = p.category_id
LEFT JOIN categories cp      ON cp.id = c.pai_id
WHERE r.status = 'normalizado';

CREATE VIEW v_gasto_mensal AS
SELECT date_trunc('month', data)::date AS mes, categoria, categoria_pai, mercado, sum(valor_total) AS total
FROM v_compras
GROUP BY 1, 2, 3, 4;

CREATE VIEW v_preco_produto AS
SELECT
  produto,
  marca,
  unidade_padrao,
  date_trunc('month', data)::date                              AS mes,
  round(avg(preco_unidade_padrao), 4)                          AS preco_medio,
  min(preco_unidade_padrao)                                    AS preco_minimo,
  (array_agg(mercado ORDER BY preco_unidade_padrao))[1]        AS mercado_do_minimo
FROM v_compras
GROUP BY produto, marca, unidade_padrao, 4;

-- Papel do agente: sem login aqui (a senha é definida no deploy), só lê as três views.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_ro') THEN
    CREATE ROLE agent_ro NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_ro;
GRANT USAGE ON SCHEMA public TO agent_ro;
GRANT SELECT ON v_compras, v_gasto_mensal, v_preco_produto TO agent_ro;
ALTER ROLE agent_ro SET default_transaction_read_only = on;
ALTER ROLE agent_ro SET statement_timeout = '3s';
