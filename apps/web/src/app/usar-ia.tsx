import { api } from "@/lib/api";

/** A caixa já vem com a última escolha do usuário. */
export async function UsarIa() {
  const { usar_ia } = await api<{ usar_ia: boolean }>("/me");
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="usar_ia" defaultChecked={usar_ia} />
      Usar IA para reconhecer os produtos
      <span className="text-suave">(sem IA é grátis e instantâneo, mas menos preciso)</span>
    </label>
  );
}
