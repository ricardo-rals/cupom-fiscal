-- Login: cada usuário vê só os próprios dados. Categorias e IPCA continuam de todos.
CREATE TABLE "users" (
  "id" SERIAL NOT NULL,
  "google_id" TEXT,
  "email" TEXT,
  "nome" TEXT NOT NULL DEFAULT '',
  "usar_ia" BOOLEAN NOT NULL DEFAULT true,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- O que existia antes do login fica com o usuário 1; o primeiro login com OWNER_EMAIL o assume.
INSERT INTO "users" ("id", "nome") VALUES (1, 'dono');
SELECT setval('users_id_seq', 1);

DO $$
DECLARE
  tabela TEXT;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['stores', 'receipts', 'products', 'normalization_cache',
                                'user_labels', 'forecasts', 'llm_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "user_id" INTEGER', tabela);
    EXECUTE format('UPDATE %I SET "user_id" = 1', tabela);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "user_id" SET NOT NULL', tabela);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("user_id") REFERENCES "users"("id") '
      'ON DELETE RESTRICT ON UPDATE CASCADE',
      tabela, tabela || '_user_id_fkey');
  END LOOP;
END
$$;

DROP INDEX "stores_cnpj_key";
CREATE UNIQUE INDEX "stores_user_id_cnpj_key" ON "stores"("user_id", "cnpj");

DROP INDEX "receipts_chave_acesso_key";
CREATE UNIQUE INDEX "receipts_user_id_chave_acesso_key" ON "receipts"("user_id", "chave_acesso");

DROP INDEX "products_nome_canonico_marca_conteudo_unidade_padrao_key";
CREATE UNIQUE INDEX "products_user_id_nome_canonico_marca_conteudo_unidade_padra_key"
  ON "products"("user_id", "nome_canonico", "marca", "conteudo", "unidade_padrao");

ALTER TABLE "normalization_cache" DROP CONSTRAINT "normalization_cache_pkey",
  ADD CONSTRAINT "normalization_cache_pkey" PRIMARY KEY ("user_id", "descricao_original", "cnpj");

CREATE INDEX "user_labels_user_id_descricao_original_idx" ON "user_labels"("user_id", "descricao_original");
CREATE INDEX "forecasts_user_id_idx" ON "forecasts"("user_id");
CREATE INDEX "llm_calls_user_id_criado_em_idx" ON "llm_calls"("user_id", "criado_em");

-- O agente só enxerga o usuário que a transação declarou em app.user_id; sem ele, nenhuma linha.
-- security_barrier impede que uma condição da consulta rode antes do filtro e veja outras linhas.
CREATE OR REPLACE VIEW v_compras WITH (security_barrier) AS
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
WHERE r.status = 'normalizado' AND NOT n.em_revisao
  AND r.user_id = NULLIF(current_setting('app.user_id', true), '')::int;
