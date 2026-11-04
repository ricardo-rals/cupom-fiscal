# Resultados das avaliações

<!-- normalizacao:inicio -->
## Normalização

- Data: 2026-11-04
- Modelo: `gemini-3.6-flash`. Prompt: `v2`. Sem exemplos de correção e com cache frio.
- Conjunto: 200 itens, 145 reais e 55 sintéticos. Respostas em `docs/normalization_predicoes.json`.
- Sem resposta válida: 0 itens, contados como erro.

| Métrica | Meta | Todos (200) | Reais (145) | Reais sem dúvida de rótulo (121) | Sintéticos (55) |
| --- | --- | --- | --- | --- | --- |
| Categoria | 90% | 97.0% | 97.2% | 100.0% | 96.4% |
| Produto e unidade | 80% | 82.0% | 80.0% | 84.3% | 87.3% |
| Produto, similaridade | - | 82.5% | 80.0% | 84.3% | 89.1% |
| Produto, texto igual | - | 59.0% | 51.7% | 55.4% | 78.2% |
| Unidade padrão | - | 99.5% | 100.0% | 100.0% | 98.2% |
| Conteúdo, tolerância de 1% | - | 99.0% | 99.3% | 100.0% | 98.2% |
| Marca | - | 92.0% | 91.0% | 93.4% | 94.5% |

### Custo e latência

- Total da rodada: US$ 0.0583 em 10 lotes, com 12460 tokens de entrada e 13068 de saída. O preço usado é o da API paga.
- Por cupom de 30 itens: US$ 0.0088, ou R$ 0.0474, a US$ 1 = R$ 5.4212 (meta: R$ 0,05).
- Latência por lote de 20: média de 7.6 s. Rejeições e novas tentativas estão incluídas; esperas por erro 503 não.

### Confiança

- Abaixo do limiar de 0.8 (iriam para revisão): 1 de 200.
- Acerto de categoria acima do limiar: 97.0%. Abaixo: 100.0%.

### Como ler estes números

- Os rótulos foram escritos pelo Claude, e o autor do projeto os aceitou sem revisão item a item. O rotulador já tinha visto respostas do Gemini para parte dos itens. Trate os números como estimativa, não como medida independente.
- Só a linha de reais mede compras de verdade. Os sintéticos completam os 200 itens e foram inventados no estilo dos cupons.
- O prompt v2 fixa saco de lixo em `Limpeza da casa`, decisão tomada olhando esses itens: eles não são um teste independente.
- Produto conta como certo com similaridade de pelo menos 80 (`token_sort_ratio`, sem acento nem caixa). Nomes equivalentes com palavras diferentes contam como erro.

### Erros de categoria

| Descrição | Origem | Esperado | Previsto | Confiança |
| --- | --- | --- | --- | --- |
| PANO LIMPEZA SCOTT DURAMAX 3D 58UN | real | Papéis e descartáveis | Limpeza da casa | 0.95 |
| ENERGETICO MONSTER 473ML FIESTA MANGO | real | Refrigerantes | Sucos e refrescos | 0.9 |
| BODY SPLASH SL XEROSA 200ML VILA LA VIDA | real | Banho e cabelo | Diversos | 0.8 |
| PANO LIMPEZA EM CASA TEM 20X22 C/2 ROLOS 50 FOLHAS | real | Papéis e descartáveis | Limpeza da casa | 0.9 |
| ALVEJ QBOA 1L | sintetico | Lavagem de roupa | Limpeza da casa | 1.0 |
| PALITO DENTE GINA C/100 | sintetico | Diversos | Papéis e descartáveis | 1.0 |
<!-- normalizacao:fim -->

<!-- previsao:inicio -->
## Previsão (dados sintéticos)

- Data: 2026-11-04
- **Séries sintéticas, não compras reais.** Nenhum produto do usuário tem ainda os 6 meses distintos exigidos; estes números mostram se os modelos funcionam em comportamentos conhecidos, não quanto erram nos preços do usuário.
- 200 séries de 18 meses, semente 42, ruído de 3% e 20% de meses sem compra. Os últimos 3 meses ficam de fora e são previstos.
- Erro: média do erro absoluto relativo ao preço real nos 3 meses. Baseline: repetir o último preço observado.

Resultado geral: erro de **6.1%** contra 5.9% do baseline (não melhor que o baseline, meta do spec).

| Comportamento | Séries | Erro | Erro do baseline | Melhor que o baseline | Cobertura do intervalo (alvo 80%) |
| --- | --- | --- | --- | --- | --- |
| Estável | 40 | 2.9% | 3.0% | 38% | 83% |
| Inflação constante | 40 | 3.7% | 4.4% | 57% | 69% |
| Degrau de preço | 40 | 5.2% | 5.0% | 30% | 75% |
| Sazonal | 40 | 13.6% | 12.0% | 12% | 53% |
| Passeio aleatório | 40 | 5.1% | 4.9% | 40% | 81% |
| Todas | 200 | 6.1% | 5.9% | 36% | 72% |

Modelo escolhido nos meses reservados: `ultimo_preco` 132, `tendencia_linear` 54, `suavizacao_exponencial` 14.
<!-- previsao:fim -->
