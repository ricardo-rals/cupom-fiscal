-- CreateEnum
CREATE TYPE "receipt_origem" AS ENUM ('qr', 'foto');

-- CreateEnum
CREATE TYPE "receipt_status" AS ENUM ('rascunho', 'confirmado', 'normalizado');

-- CreateEnum
CREATE TYPE "normalizacao_origem" AS ENUM ('llm', 'cache', 'usuario');

-- CreateEnum
CREATE TYPE "unidade_padrao" AS ENUM ('kg', 'l', 'un');

-- CreateTable
CREATE TABLE "stores" (
    "id" SERIAL NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "nome" TEXT NOT NULL,
    "cidade" TEXT,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "chave_acesso" CHAR(44) NOT NULL,
    "emitido_em" TIMESTAMPTZ NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "acrescimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pagamento" TEXT,
    "origem" "receipt_origem" NOT NULL,
    "status" "receipt_status" NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "codigo" TEXT,
    "descricao_original" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,
    "unidade" TEXT NOT NULL,
    "valor_unitario" DECIMAL(14,4) NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "pai_id" INTEGER,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "nome_canonico" TEXT NOT NULL,
    "marca" TEXT NOT NULL DEFAULT '',
    "conteudo" DECIMAL(12,4) NOT NULL,
    "unidade_padrao" "unidade_padrao" NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_normalizations" (
    "receipt_item_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "confianca" DECIMAL(4,3) NOT NULL,
    "origem" "normalizacao_origem" NOT NULL,
    "llm_call_id" INTEGER,
    "prompt_version" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_normalizations_pkey" PRIMARY KEY ("receipt_item_id")
);

-- CreateTable
CREATE TABLE "normalization_cache" (
    "descricao_original" TEXT NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "product_id" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normalization_cache_pkey" PRIMARY KEY ("descricao_original","cnpj")
);

-- CreateTable
CREATE TABLE "user_labels" (
    "id" SERIAL NOT NULL,
    "descricao_original" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecasts" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER,
    "category_id" INTEGER,
    "mes" DATE NOT NULL,
    "previsto" DECIMAL(14,4) NOT NULL,
    "limite_inferior" DECIMAL(14,4) NOT NULL,
    "limite_superior" DECIMAL(14,4) NOT NULL,
    "modelo" TEXT NOT NULL,
    "mae_validacao" DECIMAL(14,4),
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ipca_monthly" (
    "mes" DATE NOT NULL,
    "variacao" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "ipca_monthly_pkey" PRIMARY KEY ("mes")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" SERIAL NOT NULL,
    "finalidade" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL,
    "tokens_out" INTEGER NOT NULL,
    "custo" DECIMAL(12,6) NOT NULL,
    "latencia_ms" INTEGER NOT NULL,
    "trace_id" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_cnpj_key" ON "stores"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_chave_acesso_key" ON "receipts"("chave_acesso");

-- CreateIndex
CREATE INDEX "receipt_items_receipt_id_idx" ON "receipt_items"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_nome_key" ON "categories"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "products_nome_canonico_marca_conteudo_unidade_padrao_key" ON "products"("nome_canonico", "marca", "conteudo", "unidade_padrao");

-- CreateIndex
CREATE INDEX "item_normalizations_product_id_idx" ON "item_normalizations"("product_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_normalizations" ADD CONSTRAINT "item_normalizations_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_normalizations" ADD CONSTRAINT "item_normalizations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_normalizations" ADD CONSTRAINT "item_normalizations_llm_call_id_fkey" FOREIGN KEY ("llm_call_id") REFERENCES "llm_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalization_cache" ADD CONSTRAINT "normalization_cache_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_labels" ADD CONSTRAINT "user_labels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_labels" ADD CONSTRAINT "user_labels_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
