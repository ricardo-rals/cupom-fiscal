# Cupom Fiscal

Controle de compras de supermercado a partir da nota fiscal. Você importa uma NFC-e pelo link do QR Code, por uma foto ou lança uma compra sem nota; o sistema entende cada item, guarda o histórico de preços, mostra para onde vai o dinheiro, prevê o gasto do mês, sugere a lista de compras e responde perguntas sobre os seus gastos.

O problema que ele resolve: a descrição de um item na nota vem abreviada e diferente em cada mercado. `REQ BETANIA 400G TRAD` e `REQUEIJAO CREM BETANIA 400G` são o mesmo produto, mas nenhuma planilha percebe isso sozinha. O Cupom Fiscal transforma cada linha em dados estruturados para que dê para comparar preço e somar gasto de verdade.

| Linha da nota | Produto | Marca | Conteúdo | Categoria |
| --- | --- | --- | --- | --- |
| `REQ BETANIA 400G TRAD` | requeijão tradicional | Betânia | 0,4 kg | Manteiga, requeijão e creme de leite |
| `MOLHO TOM BONARE 300GR TRAD SACH` | molho de tomate tradicional | Bonare | 0,3 kg | Molhos e temperos |
| `LIMAO TAHITI kg` | limão taiti | | 1 kg | Frutas |

## O que ele faz

- **Importa a nota de três jeitos.**
  - Link do QR Code de uma NFC-e da Sefaz da Bahia: extrai mercado, data, itens, descontos e forma de pagamento.
  - Foto do cupom: se o QR Code estiver legível, segue pela Sefaz; senão, o texto é lido (Gemini ou Tesseract) e vira um rascunho para você conferir. A foto não é guardada.
  - Compra sem nota: mercado, data e itens com quantidade, unidade e valor.
- **Normaliza cada item, com ou sem IA.** Você escolhe a cada importação. Com IA, o Gemini devolve saída estruturada com produto, marca, conteúdo, unidade padrão e categoria, em lotes paralelos de 20. Sem IA (ou se o Gemini falhar), um modelo de machine learning local (TF-IDF e regressão logística, treinado com os itens rotulados e com as suas correções) categoriza na hora. A ordem de resolução é: correção do usuário, cache, modelo. Itens abaixo do limiar de confiança vão para a fila de **Revisão** e ficam fora das somas até alguém confirmar.
- **Deixa editar tudo.** Cupom, itens (incluir, editar, excluir) e a normalização de cada item. Corrigir um item grava o rótulo, ensina o modelo local e resolve os itens iguais que estão na fila.
- **Mostra para onde vai o dinheiro.** Dashboard com atalhos de período, busca por texto, filtros por categoria e mercado, indicadores (gasto com variação, cupons, ticket médio), gasto no tempo, rankings por categoria e mercado, produtos com maior gasto e histórico de preço de cada produto.
- **Ajuda a planejar.** Orçamento mensal por categoria com alerta em 80% e 100%, previsão do gasto do mês e lista de compras sugerida com o que você compra sempre e está perto de acabar.
- **Prevê preço com cautela.** Compara último preço, tendência linear e suavização exponencial. Um modelo só substitui o último preço se errar pelo menos 20% menos nos meses reservados para teste.
- **Responde perguntas em português.** O agente classifica a pergunta, gera SQL e só executa depois de validar com sqlglot: precisa ser um único `SELECT`, só nas três views liberadas, sem funções de sistema e com `LIMIT` de até 500. Roda com o papel `agent_ro`, que só lê essas views, com tempo limite de 3 segundos.
- **Separa os dados por usuário.** Login com Google; toda tabela tem `user_id` e as views do agente filtram pelo usuário da transação, então o isolamento está no banco, não no prompt.
- **Controla custo.** Teto de gasto mensal com LLM por usuário e registro de cada chamada em `llm_calls`.
- **Não guarda CPF.** Um teste varre repositório, fixtures, banco e logs atrás de CPF. Texto digitado com CPF é recusado e CPF em URL de erro é mascarado.

## Arquitetura

```
apps/web   Next.js       telas, login Google (Auth.js), dashboard, gastos, revisão e perguntas
apps/api   NestJS        regras de negócio, fila de normalização com pg-boss, Prisma
apps/ai    Python        parser da NFC-e, foto (QR, OCR), normalização com Gemini ou local, previsão e agente de SQL
evals/                   conjuntos de avaliação e scripts que geram docs/results.md
docs/                    requisitos e resultados das avaliações
```

```
navegador ──> web ──> api ──> PostgreSQL
                       │          ▲
                       └──> ai ───┘ só leitura, papel agent_ro, nas views do agente
```

O web assina um token curto para cada chamada à api (`API_TOKEN_SECRET`). Os traces dos três serviços vão para o Jaeger em http://localhost:16686.

## Instalação

Pré-requisitos: [Docker](https://www.docker.com/products/docker-desktop/) com Docker Compose e uma conta Google para o login. Chave do Gemini é opcional: sem ela tudo funciona no modo sem IA, com menos precisão.

```bash
git clone https://github.com/ricardo-rals/cupom-fiscal.git
cd cupom-fiscal
cp .env.example .env
# preencha o .env (próxima seção)
docker compose up -d --build
```

O serviço `migrate` aplica as migrations antes da api subir. Abra **http://localhost:3000** (use `localhost`, não `0.0.0.0`).

| Serviço | Endereço |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Serviço de IA | http://localhost:8000 |
| Jaeger | http://localhost:16686 |

## Configuração (`.env`)

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Sim | Usuário, senha e nome do banco. Só valem na **criação** do volume: depois disso, trocar aqui não troca no banco. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Sim | Credencial do login Google (veja abaixo). |
| `AUTH_SECRET` | Sim | Assina a sessão do login. Gere com `openssl rand -base64 32`. |
| `API_TOKEN_SECRET` | Sim | Assina as chamadas do web para a api. Gere do mesmo jeito. |
| `OWNER_EMAIL` | Não | O primeiro login com esse e-mail fica com os cupons de antes do login. |
| `AUTH_URL` | Não | Endereço que o navegador usa. Padrão `http://localhost:3000`; mude se acessar por outro endereço. |
| `GEMINI_API_KEY` | Não | Chave do Gemini (começa com `AIza`), gerada em [aistudio.google.com](https://aistudio.google.com/apikey). |
| `LLM_LIMITE_MENSAL_USD` | Não | Teto de gasto com o Gemini por usuário no mês. Padrão 5. |
| `NORMALIZACAO_LIMIAR` | Não | Confiança mínima para o item não ir à revisão. Padrão 0.8. |
| `AGENT_RO_PASSWORD` | Não | Senha do papel somente leitura do agente de perguntas (só letras e números). Sem ela, o agente fica desligado. |

### Login Google

É gratuito e não pede cartão.

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto.
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**, nome do app e seu e-mail. Em **Usuários de teste**, adicione os e-mails que vão entrar (até 100 em modo de teste).
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**, com o URI de redirecionamento `http://localhost:3000/api/auth/callback/google`.
4. Copie o ID e a chave secreta para `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` e rode `docker compose up -d`.

## Uso

1. **Cupons**: cole o link do QR Code, envie uma foto ou clique em *Lançar compra*. Marque *Usar IA* se quiser o Gemini.
2. **Cupom**: confira os itens; rascunhos de foto precisam de *Confirmar cupom*. Edite o que estiver errado.
3. **Revisão**: confirme ou corrija os itens com baixa confiança.
4. **Dashboard**, **Gastos** e **Perguntas**: acompanhe os gastos.

## Resultados

Os números completos, com custo e latência, estão em [`docs/results.md`](docs/results.md). Resumo da normalização em 200 itens:

| Métrica | Meta | Gemini (`gemini-3.6-flash`, prompt v2) | Modelo local (sem IA) |
| --- | --- | --- | --- |
| Categoria correta | 90% | 97,0% | 81,5% |
| Produto e unidade corretos | 80% | 82,0% | 16,5% |
| Marca correta | | 92,0% | |
| Custo por cupom de 30 itens | R$ 0,05 | R$ 0,047 | R$ 0 |

O modelo local acerta a categoria, mas não expande abreviações: o nome do produto fica próximo do texto da nota. O conjunto tem 145 itens de cupons reais anonimizados e 55 sintéticos, identificados na coluna `origem` de [`evals/data/normalization_gold.csv`](evals/data/normalization_gold.csv).

## Testes

A CI roda lint, testes e build das três aplicações, mais os testes de ponta a ponta da API contra um PostgreSQL real.

| App | Instalar | Testes | Qualidade |
|---|---|---|---|
| `apps/ai` | `uv sync` | `uv run pytest` | `uv run ruff check` |
| `apps/api` | `npm ci` | `npm test` e `npm run test:e2e` | `npm run lint` |
| `apps/web` | `npm ci` | `npm test` | `npm run lint` e `npm run build` |

Localmente, os testes de ponta a ponta da api precisam de um PostgreSQL descartável, separado do banco real:

```bash
docker run -d --name cupom-testdb -p 5433:5432 \
  -e POSTGRES_USER=cupom -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=cupom postgres:17-alpine
cd apps/api
DATABASE_URL=postgres://cupom:ci@localhost:5433/cupom npx prisma migrate deploy
DATABASE_URL=postgres://cupom:ci@localhost:5433/cupom npm run test:e2e
```

## Avaliações

Os scripts de avaliação chamam o LLM de verdade, por isso ficam fora da CI. Rode dentro de `apps/ai`:

```bash
uv run python ../../evals/run_normalization.py --cambio 5.40   # precisa de GEMINI_API_KEY
uv run python ../../evals/run_normalization_local.py           # modelo local, sem LLM
uv run python ../../evals/run_forecast.py                      # sem LLM, séries sintéticas
uv run python ../../evals/run_agent.py --so-gabarito           # confere o gabarito sem LLM
```

## Comandos úteis

```bash
docker compose ps                 # estado dos serviços
docker compose logs -f api        # logs de um serviço
docker compose up -d --build web  # recompila só um serviço
docker compose down               # para tudo (os dados ficam no volume db-data)
docker compose exec -T db pg_dump -U <POSTGRES_USER> -d cupom > backup.sql
```

`docker compose down -v` **apaga o banco**.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `migrate` termina com `P1000: Authentication failed` | O usuário ou a senha do `.env` não é o do volume já criado. Volte para os valores originais ou recrie o banco com `docker compose down -v` (apaga os dados). |
| Login cai em `0.0.0.0:3000/api/auth/error` | Você abriu por `0.0.0.0` ou `AUTH_URL` não bate com o endereço usado. Use `http://localhost:3000`. |
| Google diz que o app "doesn't comply with OAuth 2.0 policy" | O redirect cadastrado não é exatamente `http://localhost:3000/api/auth/callback/google`, ou seu e-mail não está em Usuários de teste. |
| Itens normalizados sem IA mesmo marcando *Usar IA* | A chave do Gemini é inválida ou o limite mensal acabou; os itens caem no modelo local. Veja `docker compose logs ai`. |
| O agente de perguntas diz que falta senha | Preencha `AGENT_RO_PASSWORD` e rode `docker compose up -d`. |

## Limitações conhecidas

- Pelo link, só lê NFC-e da Bahia; outros estados entram pela foto, aproveitando a chave de acesso do QR Code.
- Só NFC-e (modelo 65).
- Foto de cupom térmico real pode ter erros de leitura, por isso vira rascunho para conferir.
- Descontos gerais do cupom ainda não entram nos totais.
- A previsão de preço foi avaliada em séries sintéticas e ainda não bateu a meta contra o último preço, então o último preço continua sendo o padrão.
- A rodada completa da avaliação do agente de perguntas com o LLM ainda está pendente.

## Stack

NestJS, Prisma, PostgreSQL 17, pg-boss, Next.js, React, Auth.js, Tailwind, Python, FastAPI, scikit-learn, Tesseract, zxing-cpp, sqlglot, statsmodels, Gemini, OpenTelemetry, Jaeger, Docker Compose, GitHub Actions, Vitest, pytest.
