-- Orçamento mensal por categoria, por usuário.
CREATE TABLE "budgets" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "category_id" INTEGER NOT NULL,
  "valor_mensal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budgets_user_id_category_id_key" ON "budgets"("user_id", "category_id");
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
