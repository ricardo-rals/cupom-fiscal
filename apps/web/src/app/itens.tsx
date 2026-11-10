"use client";

import { useState } from "react";
import { Campo } from "./campos";

export const UNIDADES = ["un", "kg", "g", "l", "ml"];

/** Campos de um item digitado; `prefixo` separa as linhas da compra sem nota. */
export function CamposItem({ prefixo = "" }: { prefixo?: string }) {
  return (
    <>
      <div className="col-span-full">
        <Campo rotulo="Produto" name={`${prefixo}descricao_original`} maxLength={500} required />
      </div>
      <Campo
        rotulo="Quantidade"
        name={`${prefixo}quantidade`}
        inputMode="decimal"
        defaultValue="1"
        required
      />
      <label className="campo">
        Unidade
        <select name={`${prefixo}unidade`} defaultValue="un">
          {UNIDADES.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      <Campo
        rotulo="Valor pago"
        name={`${prefixo}valor_total`}
        inputMode="decimal"
        placeholder="0,00"
        required
      />
    </>
  );
}

/** Linhas de itens que crescem e encolhem; a ordem na tela é a ordem enviada. */
export function LinhasDeItens() {
  const [linhas, setLinhas] = useState([0]);
  const [proxima, setProxima] = useState(1);
  return (
    <div className="col-span-full grid gap-4">
      {linhas.map((n, posicao) => (
        <fieldset key={n} className="grid grid-cols-1 gap-3 border-t border-borda pt-3 sm:grid-cols-3">
          <legend className="text-sm text-suave">Item {posicao + 1}</legend>
          <CamposItem prefixo={`itens.${n}.`} />
          {linhas.length > 1 && (
            <button
              type="button"
              className="col-span-full justify-self-start text-sm underline"
              onClick={() => setLinhas(linhas.filter((l) => l !== n))}
            >
              Remover item {posicao + 1}
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="justify-self-start text-sm underline"
        onClick={() => {
          setLinhas([...linhas, proxima]);
          setProxima(proxima + 1);
        }}
      >
        + Adicionar item
      </button>
    </div>
  );
}
