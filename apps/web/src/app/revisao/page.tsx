import Link from "next/link";
import { Suspense } from "react";
import { resolverRevisao } from "@/app/actions";
import { CamposNormalizacao } from "@/app/campos";
import { Formulario } from "@/app/componentes";
import { api, type ItemRevisao } from "@/lib/api";
import { dataHora } from "@/lib/formato";

async function Fila() {
  const [itens, categorias] = await Promise.all([
    api<ItemRevisao[]>("/review-queue"),
    api<string[]>("/review-queue/categories"),
  ]);
  if (itens.length === 0) return <p className="mt-4 text-suave">Nenhum item aguardando revisão.</p>;
  return (
    <>
      <p className="mt-1 text-suave">
        {itens.length} {itens.length === 1 ? "item aguarda" : "itens aguardam"}. Cada correção vale
        para as próximas compras do mesmo item.
      </p>
      {itens.map((item) => (
        <section key={item.item_id} className="border-b border-borda py-5">
          <h2 className="font-medium">{item.descricao_original}</h2>
          <p className="text-sm text-suave">
            <Link href={`/cupons/${item.receipt_id}`} className="underline">
              {item.mercado}, {dataHora(item.emitido_em)}
            </Link>{" "}
            · vendido em {item.unidade} · confiança {Math.round(Number(item.confianca) * 100)}%
          </p>
          <Formulario
            acao={resolverRevisao.bind(null, item.item_id)}
            botao="Salvar correção"
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <CamposNormalizacao atual={item.sugestao} categorias={categorias} />
          </Formulario>
        </section>
      ))}
    </>
  );
}

export default function Revisao() {
  return (
    <>
      <h1 className="titulo">Fila de revisão</h1>
      <Suspense fallback={<p className="mt-4 text-suave">Carregando…</p>}>
        <Fila />
      </Suspense>
    </>
  );
}
