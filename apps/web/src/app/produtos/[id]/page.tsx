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

interface Previsao {
  tipo: "produto" | "categoria" | "insuficiente";
  categoria: string;
  meses_observados: number;
  meses_minimos?: number;
  modelo?: string;
  erro_pct?: number;
  selo?: "alta" | "media" | "baixa";
  previsoes?: { mes: string; previsto: number; inferior: number; superior: number }[];
}

const SELOS = { alta: "alta", media: "média", baixa: "baixa" };
const MODELOS: Record<string, string> = {
  ultimo_preco: "último preço",
  tendencia_linear: "tendência linear",
  suavizacao_exponencial: "suavização exponencial",
};
const meioDoMes = (mes: string) => new Date(`${mes}-15T12:00:00-03:00`).getTime();
const nomeDoMes = (mes: string) =>
  new Date(`${mes}-15T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
    timeZone: "America/Bahia",
  });

interface Precos {
  produto: string;
  marca: string;
  conteudo: string;
  unidade_padrao: string;
  categoria: string;
  pontos: Ponto[];
}

function Serie({
  pontos,
  unidade,
  previsoes = [],
}: {
  pontos: Ponto[];
  unidade: string;
  previsoes?: NonNullable<Previsao["previsoes"]>;
}) {
  const serie = pontos.map((p) => ({
    ...p,
    instante: new Date(p.emitido_em).getTime(),
    valor: Number(p.preco_padrao),
  }));
  const futuro = previsoes.map((p) => ({ ...p, instante: meioDoMes(p.mes) }));
  // A escala cobre também o intervalo previsto, para a faixa não sair do gráfico.
  const e = escalaDaSerie([
    ...serie,
    ...futuro.flatMap((p) => [
      { instante: p.instante, valor: p.inferior },
      { instante: p.instante, valor: p.superior },
    ]),
  ]);
  const primeiro = serie[0];
  const ultimo = serie[serie.length - 1];
  const fimDoEixo = futuro.length
    ? nomeDoMes(futuro[futuro.length - 1].mes)
    : dataCurta(ultimo.emitido_em);
  const ancora = { x: e.x(ultimo.instante), y: e.y(ultimo.valor) };
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
      {(serie.length > 1 || futuro.length > 0) && (
        <text x={e.direita} y={ALTURA - 8} textAnchor="end" className="eixo">
          {fimDoEixo}
        </text>
      )}
      {futuro.length > 0 && (
        <>
          <polygon
            className="faixa"
            points={[
              `${ancora.x},${ancora.y}`,
              ...futuro.map((p) => `${e.x(p.instante)},${e.y(p.superior)}`),
              ...[...futuro].reverse().map((p) => `${e.x(p.instante)},${e.y(p.inferior)}`),
            ].join(" ")}
          />
          <polyline
            className="linha linha-prevista"
            points={[
              `${ancora.x},${ancora.y}`,
              ...futuro.map((p) => `${e.x(p.instante)},${e.y(p.previsto)}`),
            ].join(" ")}
          />
          {futuro.map((p) => (
            <g key={p.mes} className="ponto">
              <title>
                {`${nomeDoMes(p.mes)} · previsto ${moeda(p.previsto)}/${unidade}, entre ${moeda(p.inferior)} e ${moeda(p.superior)}`}
              </title>
              <circle cx={e.x(p.instante)} cy={e.y(p.previsto)} r={14} fill="transparent" />
              <circle
                cx={e.x(p.instante)}
                cy={e.y(p.previsto)}
                r={4}
                className="marca-prevista"
              />
            </g>
          ))}
        </>
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

function SecaoPrevisao({ previsao, unidade }: { previsao: Previsao; unidade: string }) {
  if (previsao.tipo === "insuficiente") {
    return (
      <p className="mt-2 text-suave">
        Histórico insuficiente: {previsao.meses_observados} de {previsao.meses_minimos} meses com
        compra, e a categoria {previsao.categoria} também não tem variação suficiente.
      </p>
    );
  }
  const erro = (previsao.erro_pct! * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return (
    <>
      <p className="mt-2">
        <span className={`selo selo-${previsao.selo}`}>
          Confiabilidade {SELOS[previsao.selo!]}
        </span>{" "}
        <span className="text-sm text-suave">
          erro médio de {erro}% nos 2 meses reservados · modelo{" "}
          {MODELOS[previsao.modelo!] ?? previsao.modelo}
        </span>
      </p>
      {previsao.tipo === "categoria" && (
        <p className="aviso">
          Previsão derivada: este produto tem {previsao.meses_observados}{" "}
          {previsao.meses_observados === 1 ? "mês" : "meses"} de compra, então ela aplica ao último
          preço a variação prevista para {previsao.categoria}.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="tabela">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="numero">Previsto R$/{unidade}</th>
              <th className="numero">Intervalo de 80%</th>
            </tr>
          </thead>
          <tbody>
            {previsao.previsoes!.map((p) => (
              <tr key={p.mes}>
                <td>{nomeDoMes(p.mes)}</td>
                <td className="numero">{moeda(p.previsto)}</td>
                <td className="numero">
                  {moeda(p.inferior)} a {moeda(p.superior)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Produto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [dados, previsao] = await Promise.all([
    api<Precos>(`/products/${id}/prices`),
    api<Previsao>(`/products/${id}/forecast`),
  ]).catch((erro) => {
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
          {previsao.previsoes && (
            <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-suave">
              <span>● Compras</span>
              <span>○ Previsão, com faixa de 80%</span>
            </p>
          )}
          <Serie pontos={dados.pontos} unidade={unidade} previsoes={previsao.previsoes} />

          <h2 className="subtitulo mt-6">Próximos 3 meses</h2>
          <SecaoPrevisao previsao={previsao} unidade={unidade} />

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
