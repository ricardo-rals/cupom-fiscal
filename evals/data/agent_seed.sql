-- Compras SINTÉTICAS e determinísticas para avaliar o agente: maio a outubro de 2026,
-- 3 mercados e 12 produtos. As respostas certas saem do SQL de gabarito sobre estes dados.
-- Tudo no usuário 1, que a migration de login cria; o agente roda com app.user_id = 1.
INSERT INTO stores (user_id, cnpj, nome, cidade) VALUES
  (1, '90000000000101', 'ATACADAO CENTRO', 'SALVADOR'),
  (1, '90000000000202', 'MERCADINHO BOM PRECO', 'SALVADOR'),
  (1, '90000000000303', 'SUPERMERCADO BAHIA', 'SALVADOR');

INSERT INTO products (user_id, nome_canonico, marca, conteudo, unidade_padrao, category_id)
SELECT 1, v.nome, v.marca, v.conteudo, v.unidade::unidade_padrao, c.id
FROM (VALUES
  ('leite integral', 'italac', 1, 'l', 'Leite'),
  ('arroz tipo 1', 'camil', 5, 'kg', 'Arroz e feijão'),
  ('feijao carioca', 'kicaldo', 1, 'kg', 'Arroz e feijão'),
  ('cafe torrado e moido', 'melitta', 0.5, 'kg', 'Café e chá'),
  ('banana prata', '', 1, 'kg', 'Frutas'),
  ('tomate', '', 1, 'kg', 'Legumes e verduras'),
  ('file de peito de frango', 'sadia', 1, 'kg', 'Aves'),
  ('detergente neutro', 'ype', 0.5, 'l', 'Louça'),
  ('refrigerante de cola', 'coca-cola', 2, 'l', 'Refrigerantes'),
  ('cerveja lager', 'heineken', 0.35, 'l', 'Bebidas alcoólicas'),
  ('queijo mussarela fatiado', 'betania', 1, 'kg', 'Queijos'),
  ('papel higienico', 'neve', 12, 'un', 'Absorventes e papel higiênico')
) AS v(nome, marca, conteudo, unidade, categoria)
JOIN categories c ON c.nome = v.categoria;

DO $$
DECLARE
  -- Preço da embalagem em maio no mercado do meio, na ordem dos produtos acima.
  precos numeric[] := ARRAY[5.49, 27.90, 8.99, 18.90, 6.50, 7.80, 21.90, 2.79, 9.99, 6.49, 49.90, 22.90];
  pesados int[] := ARRAY[5, 6, 7, 11]; -- vendidos a granel, em kg
  nomes text[] := ARRAY['leite integral', 'arroz tipo 1', 'feijao carioca', 'cafe torrado e moido',
    'banana prata', 'tomate', 'file de peito de frango', 'detergente neutro', 'refrigerante de cola',
    'cerveja lager', 'queijo mussarela fatiado', 'papel higienico'];
  mercados int[];
  produtos int[];
  cupom int;
  item int;
  n int := 0;
  quantidade numeric;
  preco numeric;
  soma numeric;
BEGIN
  SELECT array_agg(id ORDER BY cnpj) INTO mercados FROM stores WHERE cnpj LIKE '9000000000%';
  SELECT array_agg(id ORDER BY array_position(nomes, nome_canonico)) INTO produtos
    FROM products WHERE nome_canonico = ANY (nomes);

  FOR m IN 0..5 LOOP
    FOR s IN 1..3 LOOP
      n := n + 1;
      INSERT INTO receipts (user_id, store_id, chave_acesso, emitido_em, total, origem, status)
      VALUES (1, mercados[s], '29' || lpad(n::text, 42, '0'),
              make_timestamptz(2026, 5 + m, 3 + 8 * s, 10 + s, 0, 0, 'America/Bahia'), 0, 'qr', 'normalizado')
      RETURNING id INTO cupom;
      soma := 0;
      FOR p IN 1..12 LOOP
        CONTINUE WHEN (p + s + m) % 3 = 0;
        quantidade := CASE WHEN p = ANY (pesados) THEN 0.5 + ((p + m + s) % 4) * 0.25
                           WHEN p = 1 THEN 6 ELSE 1 + (p + m) % 2 END;
        -- Inflação de 1,5% ao mês; o Atacadão é 5% mais barato e o Supermercado Bahia, 5% mais caro.
        preco := round(precos[p] * power(1.015, m) * (1 + 0.05 * (s - 2)), 2);
        INSERT INTO receipt_items (receipt_id, descricao_original, quantidade, unidade, valor_unitario, valor_total)
        VALUES (cupom, 'ITEM ' || p, quantidade, CASE WHEN p = ANY (pesados) THEN 'KG' ELSE 'UN' END,
                preco, round(preco * quantidade, 2))
        RETURNING id INTO item;
        INSERT INTO item_normalizations (receipt_item_id, product_id, confianca, origem)
        VALUES (item, produtos[p], 0.95, 'llm');
        soma := soma + round(preco * quantidade, 2);
      END LOOP;
      UPDATE receipts SET total = soma WHERE id = cupom;
    END LOOP;
  END LOOP;
END $$;
