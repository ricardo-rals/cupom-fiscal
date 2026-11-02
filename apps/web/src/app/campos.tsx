import type { ComponentProps } from "react";
import type { Normalizacao } from "@/lib/api";

export function Campo({ rotulo, ...props }: { rotulo: string } & ComponentProps<"input">) {
  return (
    <label className="campo">
      {rotulo}
      <input {...props} />
    </label>
  );
}

export function CamposNormalizacao({
  atual,
  categorias,
}: {
  atual: Normalizacao | null;
  categorias: string[];
}) {
  return (
    <>
      <Campo rotulo="Produto" name="produto" defaultValue={atual?.produto} required />
      <Campo rotulo="Marca" name="marca" defaultValue={atual?.marca} />
      <Campo
        rotulo="Conteúdo"
        name="conteudo"
        inputMode="decimal"
        defaultValue={atual ? Number(atual.conteudo) : 1}
        required
      />
      <label className="campo">
        Unidade
        <select name="unidade_padrao" defaultValue={atual?.unidade_padrao ?? "un"}>
          <option value="kg">kg</option>
          <option value="l">l</option>
          <option value="un">un</option>
        </select>
      </label>
      <label className="campo col-span-full">
        Categoria
        <select name="categoria" defaultValue={atual?.categoria ?? ""} required>
          <option value="" disabled>
            Escolha…
          </option>
          {categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
    </>
  );
}
