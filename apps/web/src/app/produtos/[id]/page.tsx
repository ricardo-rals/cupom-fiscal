import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { api, ErroApi } from "@/lib/api";
import { dataCurta, dataHora, moeda } from "@/lib/formato";
import { ALTURA, escalaDaSerie, LARGURA } from "@/lib/grafico";

interface Ponto {
  item_id: number;
  receipt_id: number;
  emitido_em: string;
  mercado: string;
  quantidade: string;
  unidade: string;
  preco_unitario: string;
  preco_padrao: string;
}

interface Precos {
  produto: string;
  marca: string;
  conteudo: string;
  unidade_padrao: string;
  categoria: string;
  pontos: Ponto[];
}

function Serie({ pontos, unidade }: { pontos: Ponto[]; unidade: string }) {
  const serie = pontos.map((p) => ({
    ...p,
    instante: new Date(p.emitido_em).getTime(),
    valor: Number(p.preco_padrao),
  }));
  const e = escalaDaSerie(serie);
  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];
  return (
    <svg
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      className="mt-3 w-full"
      role="img"
      aria-label={`Preço por ${unidade} em ${serie.length} compras; os valores estão na tabela abaixo.`}
    >
      {e.marcas.map((m) => (
        <g key={m.valor}>
          <line x1={e.esquerda} x2={e.direita} y1={m.y} y2={m.y} className="grade" />
          <text x={e.esquerda - 8} y={m.y + 4} textAnchor="end" className="eixo">
            {moeda(m.valor)}
          </text>
        </g>
      ))}
      <text x={e.esquerda} y={ALTURA - 8} className="eixo">
        {dataCurta(primeiro.emitido_em)}
      </text>
      {serie.length > 1 && (
        <text x={e.direita} y={ALTURA - 8} textAnchor="end" className="eixo">
          {dataCurta(ultimo.emitido_em)}
        </text>
      )}
      <polyline
        points={serie.map((p) => `${e.x(p.instante)},${e.y(p.valor)}`).join(" ")}
        className="linha"
      />
      {serie.map((p) => (
        <g key={p.item_id} className="ponto">
          <title>
            {`${dataHora(p.emitido_em)} · ${p.mercado} · ${moeda(p.valor)}/${unidade}`}
          </title>
          {/* Alvo maior que a marca, para o mouse e o dedo acertarem. */}
          <circle cx={e.x(p.instante)} cy={e.y(p.valor)} r={14} fill="transparent" />
          <circle cx={e.x(p.instante)} cy={e.y(p.valor)} r={4} className="marca" />
        </g>
      ))}
    </svg>
  );
}

async function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const dados = await api<Precos>(`/products/${id}/prices`).catch((erro) => {
    if (erro instanceof ErroApi && erro.codigo === "produto_nao_encontrado") notFound();
    throw erro;
  });
  const unidade = dados.unidade_padrao;

  return (
    <>
      <h1 className="titulo">{dados.produto}</h1>
      <p className="mt-1 text-suave">
        {dados.marca && `${dados.marca} · `}
        {Number(dados.conteudo)} {unidade} · {dados.categoria}
      </p>

      {dados.pontos.length === 0 ? (
        <p className="mt-6 text-suave">Nenhuma compra confirmada deste produto.</p>
      ) : (
        <>
          <h2 className="subtitulo mt-6">Preço por {unidade}</h2>
          <Serie pontos={dados.pontos} unidade={unidade} />

          <div className="mt-6 overflow-x-auto">
            <table className="tabela">
              <caption className="subtitulo mb-2 text-left">Compras</caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Mercado</th>
                  <th className="numero">Qtde.</th>
                  <th className="numero">Preço unitário</th>
                  <th className="numero">R$/{unidade}</th>
                </tr>
              </thead>
              <tbody>
                {[...dados.pontos].reverse().map((p) => (
                  <tr key={p.item_id}>
                    <td>
                      <Link href={`/cupons/${p.receipt_id}`} className="underline">
                        {dataHora(p.emitido_em)}
                      </Link>
                    </td>
                    <td>{p.mercado}</td>
                    <td className="numero">
                      {Number(p.quantidade).toLocaleString("pt-BR")} {p.unidade}
                    </td>
                    <td className="numero">{moeda(p.preco_unitario)}</td>
                    <td className="numero">{moeda(p.preco_padrao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function PaginaProduto({ params }: PageProps<"/produtos/[id]">) {
  return (
    <Suspense fallback={<p className="text-suave">Carregando…</p>}>
      <Produto params={params} />
    </Suspense>
  );
}
