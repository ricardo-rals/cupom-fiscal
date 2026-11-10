import { connection } from "next/server";
import { Suspense } from "react";
import { lancarCompra } from "@/app/actions";
import { Campo } from "@/app/campos";
import { Formulario } from "@/app/componentes";
import { LinhasDeItens } from "@/app/itens";
import { UsarIa } from "@/app/usar-ia";

const hoje = () =>
  new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // America/Bahia

async function Data() {
  await connection(); // a data de hoje nunca vem do prerender
  return <Campo rotulo="Data" name="data" type="date" defaultValue={hoje()} required />;
}

export default function NovaCompra() {
  return (
    <>
      <h1 className="titulo">Compra sem nota</h1>
      <p className="mt-1 text-suave">
        Para feira, padaria ou qualquer lugar que não deu cupom. Os itens passam pela mesma
        normalização.
      </p>
      <Formulario acao={lancarCompra} botao="Lançar compra" className="mt-4 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Onde" name="mercado" maxLength={200} placeholder="Compra sem nota" />
        <Suspense>
          <Data />
        </Suspense>
        <LinhasDeItens />
        <div className="col-span-full">
          <Suspense>
            <UsarIa />
          </Suspense>
        </div>
      </Formulario>
    </>
  );
}
