# Cupom Fiscal

Controle de compras de supermercado a partir do QR Code da nota fiscal. Você cola o link do QR Code de uma NFC-e da Bahia e o sistema lê a nota, entende cada item, guarda o histórico de preços e responde perguntas sobre os seus gastos.

O problema que ele resolve: a descrição de um item na nota vem abreviada e diferente em cada mercado. `REQ BETANIA 400G TRAD` e `REQUEIJAO CREM BETANIA 400G` são o mesmo produto, mas nenhuma planilha percebe isso sozinha. O Cupom Fiscal transforma cada linha em dados estruturados para que dê para comparar preço e somar gasto de verdade.

| Linha da nota | Produto | Marca | Conteúdo | Categoria |
| --- | --- | --- | --- | --- |
| `REQ BETANIA 400G TRAD` | requeijão tradicional | Betânia | 0,4 kg | Manteiga, requeijão e creme de leite |
| `MOLHO TOM BONARE 300GR TRAD SACH` | molho de tomate tradicional | Bonare | 0,3 kg | Molhos e temperos |
| `LIMAO TAHITI kg` | limão taiti | | 1 kg | Frutas |

## O que ele faz

- **Importa a nota pelo QR Code.** Lê a página da NFC-e da Sefaz da Bahia e extrai mercado, data, itens, descontos e forma de pagamento.
- **Normaliza cada item com LLM.** Saída estruturada com produto, marca, conteúdo, unidade padrão e categoria. A ordem de resolução é: correção feita pelo usuário, depois cache, depois o modelo em lotes de 20. Itens abaixo do limiar de confiança vão para uma fila de revisão e ficam fora das somas até alguém confirmar.
- **Aprende com as correções.** Corrigir um item grava o rótulo e resolve os itens iguais que estão na fila.
- **Mostra para onde vai o dinheiro.** Painel por período, categoria, mercado e produto, com comparação ao período anterior, e histórico de preço de cada produto por mercado.
- **Prevê preço com cautela.** Compara último preço, tendência linear e suavização exponencial. Um modelo só substitui o último preço se errar pelo menos 20% menos nos meses reservados para teste.
- **Responde perguntas em português.** O agente classifica a pergunta, gera SQL e só executa depois de validar com sqlglot: precisa ser um único `SELECT`, só nas três views liberadas, sem funções de sistema e com `LIMIT` de até 500. Roda com o papel `agent_ro`, que só lê essas views, com tempo limite de 3 segundos.
- **Controla custo.** Teto de gasto mensal com LLM e registro de cada chamada em `llm_calls`.
- **Não guarda CPF.** Um teste varre repositório, fixtures, banco e logs atrás de CPF. Texto digitado com CPF é recusado e CPF em URL de erro é mascarado.

## Arquitetura

```
apps/web   Next.js       telas de importação, revisão, painel, produto e perguntas
apps/api   NestJS        regras de negócio, fila de normalização com pg-boss, Prisma
apps/ai    Python        parser da NFC-e, normalização com Gemini, previsão e agente de SQL
evals/                   conjuntos de avaliação e scripts que geram docs/results.md
```

```
navegador ──> web ──> api ──> PostgreSQL
                       │          ▲
                       └──> ai ───┘ só leitura, papel agent_ro, nas views do agente
```

## Resultados

Os números completos, com custo e latência, estão em [`docs/results.md`](docs/results.md). Resumo da normalização com `gemini-3.6-flash`, prompt v2, sem exemplos no prompt e com cache frio:

| Métrica | Meta | Resultado em 200 itens |
| --- | --- | --- |
| Categoria correta | 90% | 97,0% |
| Produto e unidade corretos | 80% | 82,0% |
| Marca correta | | 92,0% |
| Custo por cupom de 30 itens | R$ 0,05 | R$ 0,047 |

O conjunto tem 145 itens de cupons reais anonimizados e 55 sintéticos, identificados na coluna `origem` de [`evals/data/normalization_gold.csv`](evals/data/normalization_gold.csv).

## Como rodar

Pré-requisito: Docker com Docker Compose.

```bash
cp .env.example .env
# Edite o .env: troque POSTGRES_PASSWORD e, se quiser IA, preencha GEMINI_API_KEY e AGENT_RO_PASSWORD
docker compose up --build
```

| Serviço | Endereço |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Serviço de IA | http://localhost:8000 |

Sem `GEMINI_API_KEY`, os itens novos vão direto para a fila de revisão. Sem `AGENT_RO_PASSWORD`, o agente de perguntas fica desligado.

## Testes

A CI roda lint, testes e build das três aplicações, mais os testes de ponta a ponta da API contra um PostgreSQL real.

```bash
cd apps/api && npm test && npm run test:e2e
cd apps/web && npm test
cd apps/ai  && uv run pytest
```

## Avaliações

Os scripts de avaliação chamam o LLM de verdade, por isso ficam fora da CI. Rode dentro de `apps/ai`:

```bash
uv run python ../../evals/run_normalization.py --cambio 5.40   # precisa de GEMINI_API_KEY
uv run python ../../evals/run_forecast.py                      # sem LLM, séries sintéticas
uv run python ../../evals/run_agent.py --so-gabarito           # confere o gabarito sem LLM
```

## Limitações conhecidas

- Só lê NFC-e da Bahia por enquanto.
- Descontos gerais do cupom ainda não entram nos totais.
- A previsão foi avaliada em séries sintéticas e ainda não bateu a meta contra o último preço, então o último preço continua sendo o padrão.
- A rodada completa da avaliação do agente de perguntas com o LLM ainda está pendente.

## Stack

NestJS, Prisma, PostgreSQL 17, pg-boss, Next.js, React, Python, FastAPI, sqlglot, statsmodels, Gemini, Docker Compose, GitHub Actions, Vitest, pytest.
