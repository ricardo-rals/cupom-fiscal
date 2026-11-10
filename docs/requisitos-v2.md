# Requisitos v2

Status: **aguardando aprovação**. Cada etapa vira um commit (ou mais) e só começa depois da anterior aprovada.

## Decisões

| Tema | Decisão |
|---|---|
| Login | Google (Auth.js no web). Sem senha guardada. |
| Notas aceitas | Só NFC-e, por QR/link, foto ou digitação. NF-e (modelo 55) fica fora por enquanto. |
| Compra sem nota | Lançamento manual: mercado (opcional), data, itens com descrição, quantidade, valor e unidade. |
| Itens | Incluir, excluir e editar em qualquer cupom, inclusive nos importados. |
| IA | O usuário escolhe, por importação, **com IA** ou **sem IA** (com um padrão salvo no perfil). Sem IA tudo continua funcionando, com menos precisão. |
| Deep learning | Fora. O histórico de uma pessoa não tem volume para isso. |
| RAG | Já existe em forma léxica: `_exemplos` em `normalize/llm.py` busca correções parecidas e manda como exemplo. Trocar por embeddings (pgvector) só se as avaliações mostrarem que a busca léxica erra. |

## Etapa 0: lentidão da normalização

Diagnóstico pelo código (falta medir, o Docker estava parado):

1. `normalizarCupom` manda os lotes de 20 itens **um depois do outro**. Um cupom de 46 itens espera 3 chamadas ao Gemini em sequência.
2. Cada lote pode repetir até 3 vezes se a resposta vier com ids errados, somando o tempo.
3. Se o Gemini falhar (sobrecarga, 503), o job volta para a fila com espera de 30 s que dobra a cada tentativa: 30, 60, 120 s... Isso parece "travado" para quem espera.
4. `resolverSemLlm` faz 2 consultas por item (N+1). É pouco perto do LLM, mas sai de graça.

Plano: medir no Jaeger (já configurado no `docker-compose.yml`) qual desses pesa; mandar os lotes em paralelo (tratando a corrida no `upsert` de produto); trocar o N+1 por duas consultas; com o modo sem IA da etapa 2, o resultado local aparece na hora e o LLM refina depois.

Aceite: cupom de 46 itens normalizado em menos de 1/2 do tempo atual, medido antes e depois.

## Etapa 1: login e dados por usuário

- Tabela `users` (id do Google, e-mail, nome, preferência de IA).
- `user_id` em `receipts`, `user_labels`, `forecasts`, `llm_calls`. Produtos, categorias e o cache de normalização continuam compartilhados (não têm dado pessoal).
- `chave_acesso` passa a ser única **por usuário**.
- O web assina um token curto para cada chamada à api; a api recusa sem token.
- Agente de perguntas: as views filtram por `current_setting('app.user_id')`, definido pela api na transação. O validador de SQL bloqueia `set_config` e `SET`. O isolamento fica no banco, não no prompt.
- Limite de gasto com LLM passa a ser por usuário.
- Dados atuais vão para o usuário cujo e-mail estiver em `OWNER_EMAIL` no primeiro login.

Aceite: teste e2e com dois usuários em que nenhum endpoint e nenhuma pergunta ao agente devolve dado do outro.

## Etapa 2: modo sem IA

- Classificador local (scikit-learn: TF-IDF de caracteres + regressão logística) para a categoria, treinado com `evals/data/normalization_gold.csv` e as correções do usuário.
- Produto: busca do mais parecido entre os produtos já conhecidos (`rapidfuzz`, já instalado); conteúdo e unidade por regex ("200G" vira 0,2 kg).
- Confiança baixa vai para a fila de revisão, como hoje.
- Com IA: o LLM só recebe os itens em que o modelo local ficou inseguro (fica mais barato e mais rápido).

Aceite: `evals/run_normalization.py` roda nos dois modos e o `docs/results.md` mostra os dois lado a lado.

## Etapa 3: itens e compra manual

- api: `POST /receipts/:id/items`, `DELETE /receipts/:id/items/:itemId` (a edição já existe), com o total do cupom recalculado.
- `POST /receipts/manual`: compra sem nota. `chave_acesso` e loja passam a ser opcionais; nova origem `manual`.
- Unidade escolhida numa lista fechada (kg, g, l, ml, un...) e convertida para `kg`/`l`/`un`.
- web: o mesmo formulário de itens serve para editar o cupom e para a compra manual.

Aceite: incluir, editar e excluir itens atualiza total, dashboard e previsões.

## Etapa 4: importação por foto

Ordem de tentativa, a mesma com e sem IA:

1. Ler o **QR code** da foto e seguir pela consulta normal à SEFAZ.
2. Se não houver QR legível ou o estado não for suportado: **OCR**. Sem IA: Tesseract local. Com IA: Gemini lendo a imagem.
3. O resultado do OCR entra como rascunho para revisão antes de confirmar (OCR erra; nada entra direto).

Outros estados: cada SEFAZ nova entra quando houver um cupom real dela para servir de teste (como os fixtures da BA). Muitos estados usam o mesmo layout, então o leitor da BA deve servir para vários.

A foto passa pelas mesmas proteções de hoje: sem guardar CPF, tamanho e tipo de arquivo limitados.

Aceite: foto de cupom da BA com QR importa igual ao link; foto sem QR vira rascunho editável.

## Etapa 5: gastos, previsão e lista de compras

- **Orçamento** mensal por categoria, com alerta no dashboard ao passar de 80% e de 100%.
- **Previsão de gasto** do mês por categoria, reaproveitando `forecast/modelos.py`.
- **Lista de compras**: para cada produto comprado ao menos 3 vezes, o intervalo típico entre compras (mediana). Sugere o que está perto de acabar, com a quantidade de sempre e o preço esperado.

Aceite: com o `evals/data/agent_seed.sql`, a lista sugere os produtos recorrentes e não sugere os de compra única.

## Fora do escopo agora

NF-e modelo 55, app mobile, compartilhar dados entre usuários (família), deep learning.
