-- Normalização sem IA: resultado do modelo local e a escolha feita em cada importação.
ALTER TYPE "normalizacao_origem" ADD VALUE 'local';
ALTER TABLE "receipts" ADD COLUMN "usar_ia" BOOLEAN NOT NULL DEFAULT true;
