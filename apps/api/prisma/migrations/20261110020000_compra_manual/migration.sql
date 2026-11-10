-- Compra sem nota: sem chave de acesso nem CNPJ. Os índices únicos aceitam vários NULL.
ALTER TYPE "receipt_origem" ADD VALUE 'manual';
ALTER TABLE "receipts" ALTER COLUMN "chave_acesso" DROP NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "cnpj" DROP NOT NULL;
