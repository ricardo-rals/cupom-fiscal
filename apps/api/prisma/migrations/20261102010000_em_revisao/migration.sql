-- Item de baixa confiança guarda a sugestão do LLM, mas só conta como resolvido depois da revisão.
ALTER TABLE item_normalizations ADD COLUMN em_revisao BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW v_compras AS
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
WHERE r.status = 'normalizado' AND NOT n.em_revisao;
