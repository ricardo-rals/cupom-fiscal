"use client";

import { useActionState } from "react";
import { Campo } from "@/app/campos";
import { perguntar } from "./actions";

const celula = (valor: unknown) =>
  typeof valor === "number" ? valor.toLocaleString("pt-BR") : String(valor ?? "");

export function Pergunta() {
  const [estado, enviar, enviando] = useActionState(perguntar, {});
  const resultado = estado.resultado;
  return (
    <>
      <form action={enviar} className="mt-4 grid gap-3">
        <Campo
          rotulo="Sua pergunta"
          name="pergunta"
          maxLength={500}
          defaultValue={estado.pergunta}
          required
        />
        <div>
          <button className="botao" disabled={enviando}>
            {enviando ? "Pensando…" : "Perguntar"}
          </button>
        </div>
      </form>

      <div aria-live="polite" className="mt-6">
        {estado.erro && <p className="text-erro">{estado.erro}</p>}
        {resultado && (
          <>
            <p className={resultado.recusa ? "aviso" : "text-lg"}>{resultado.resposta}</p>
            {resultado.colunas.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      {resultado.colunas.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.linhas.map((linha, i) => (
                      <tr key={i}>
                        {linha.map((valor, j) => (
                          <td key={j} className={typeof valor === "number" ? "numero" : ""}>
                            {celula(valor)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {resultado.sql && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-suave">Consulta usada</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">
                  {resultado.sql}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}
