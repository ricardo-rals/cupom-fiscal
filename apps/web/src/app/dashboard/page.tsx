import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { Campo } from "@/app/campos";
import { api, ErroApi, type Orcamento } from "@/lib/api";
import { dataCurta, moeda } from "@/lib/formato";
import {
  agruparPorPeriodo,
  type Granularidade,
  hojeNaBahia,
  periodoPadrao,
  topoDoEixo,
} from "@/lib/grafico";

const MAX_LINHAS = 8;
const MAX_PRODUTOS = 15;

interface Linha {
  id?: number;
  nome: string;
  marca?: string;
  total: string;
}

interface Resumo {
  from: string;
  to: string;
  total: string;
  cupons: number;
  anterior: { from: string; to: string; total: string; variacao_pct: string | null };
  por_dia: { dia: string; total: string }[];
  por_categoria: Linha[];
  por_mercado: Linha[];
  por_produto: Linha[];
  opcoes: { categorias: string[]; mercados: { id: number; nome: string }[] };
}

type Filtros = Record<"from" | "to" | "category" | "store" | "q", string>;

const pct = (parte: number, todo: number) =>
  todo > 0
    ? `${((parte / todo) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
    : "—";

const linkCom = (filtros: Filtros, mudanca: Partial<Filtros>) => {
  const params = Object.entries({ ...filtros, ...mudanca }).filter(([, v]) => v);
  return `/dashboard?${new URLSearchParams(params)}`;
};

/** Atalhos de período: um clique em vez de dois campos de data. */
function Atalhos({ filtros }: { filtros: Filtros }) {
  const hoje = hojeNaBahia();
  const menos = (dias: number) =>
    new Date(Date.parse(`${hoje}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  const opcoes = [
    { rotulo: "Este mês", from: `${hoje.slice(0, 7)}-01` },
    { rotulo: "30 dias", from: menos(29) },
    { rotulo: "90 dias", from: menos(89) },
    { rotulo: "12 meses", from: menos(364) },
    { rotulo: "Este ano", from: `${hoje.slice(0, 4)}-01-01` },
  ];
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Períodos">
      {opcoes.map((o) => {
        const ativo = filtros.from === o.from && filtros.to === hoje;
        return (
          <Link
            key={o.rotulo}
            href={linkCom(filtros, { from: o.from, to: hoje })}
            aria-current={ativo ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              ativo
                ? "border-primaria bg-primaria-suave font-medium text-primaria"
                : "border-borda text-suave hover:text-foreground"
            }`}
          >
            {o.rotulo}
          </Link>
        );
      })}
    </div>
  );
}

function FormularioFiltros({ filtros, resumo }: { filtros: Filtros; resumo: Resumo }) {
  return (
    <form className="cartao grid grid-cols-2 items-end gap-3 lg:grid-cols-6">
      <div className="col-span-full">
        <Atalhos filtros={filtros} />
      </div>
      <Campo rotulo="De" name="from" type="date" defaultValue={filtros.from} required />
      <Campo rotulo="Até" name="to" type="date" defaultValue={filtros.to} required />
      <label className="campo">
        Categoria
        <select name="category" defaultValue={filtros.category}>
          <option value="">Todas</option>
          {resumo.opcoes.categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Mercado
        <select name="store" defaultValue={filtros.store}>
          <option value="">Todos</option>
          {resumo.opcoes.mercados.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-2 flex items-end gap-2">
        <div className="flex-1">
          <Campo
            rotulo="Buscar"
            name="q"
            type="search"
            defaultValue={filtros.q}
            maxLength={100}
            placeholder="Produto, marca ou mercado"
          />
        </div>
        <button className="botao">Filtrar</button>
      </div>
    </form>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
  texto = false,
}: {
  rotulo: string;
  valor: string;
  detalhe?: ReactNode;
  texto?: boolean;
}) {
  return (
    <div className="cartao h-full">
      <p className="rotulo">{rotulo}</p>
      <p
        className={`mt-1 font-semibold tracking-tight ${texto ? "line-clamp-2 text-lg leading-snug" : "truncate text-2xl"}`}
        title={valor}
      >
        {valor}
      </p>
      {detalhe && <p className="mt-1 text-sm text-suave">{detalhe}</p>}
    </div>
  );
}

/** Gastar mais é ruim: subida em vermelho, queda em verde, sempre com seta e texto. */
function Variacao({ resumo }: { resumo: Resumo }) {
  const { anterior } = resumo;
  if (anterior.variacao_pct === null) return <>Sem compras no período anterior</>;
  const v = Number(anterior.variacao_pct);
  const cor = v > 0 ? "text-erro" : v < 0 ? "text-bom" : "";
  return (
    <span title={`Período anterior: ${dataCurta(anterior.from)} a ${dataCurta(anterior.to)}`}>
      <span className={`font-medium ${cor}`}>
        {v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}
        {v.toLocaleString("pt-BR")}%
      </span>{" "}
      vs. {moeda(anterior.total)} antes
    </span>
  );
}

const ROTULO_PERIODO: Record<Granularidade, string> = {
  dia: "por dia",
  semana: "por semana",
  mes: "por mês",
};

function rotuloDoGrupo(inicio: string, g: Granularidade, curto = false) {
  const data = new Date(`${inicio}T12:00:00Z`);
  if (g === "mes")
    return data.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
  const dia = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return g === "semana" && !curto ? `semana de ${dia}` : dia;
}

const moedaCurta = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: valor >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  });

/** Colunas no tempo: uma cor, eixo a partir do zero, dica com o valor ao passar o mouse. */
function GraficoNoTempo({ resumo }: { resumo: Resumo }) {
  const { granularidade, grupos } = agruparPorPeriodo(resumo.por_dia, resumo.from, resumo.to);
  const L = 720;
  const A = 220;
  const m = { topo: 12, direita: 8, base: 26, esquerda: 64 };
  const largura = L - m.esquerda - m.direita;
  const altura = A - m.topo - m.base;
  const base = m.topo + altura;
  const topo = topoDoEixo(Math.max(...grupos.map((g) => g.total)));
  const faixa = largura / grupos.length;
  const coluna = Math.max(Math.min(faixa * 0.7, 40), 2);
  const y = (v: number) => base - (v / topo) * altura;
  const passo = Math.ceil(grupos.length / 6);
  const media = grupos.reduce((s, g) => s + g.total, 0) / grupos.length;
  const titulo = `Gasto ${ROTULO_PERIODO[granularidade]}`;

  return (
    <section className="cartao">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="subtitulo">{titulo}</h2>
        <p className="text-sm text-suave">
          Média de {moeda(media)} {ROTULO_PERIODO[granularidade]}
        </p>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} className="mt-4 w-full" role="img" aria-label={titulo}>
        {[0, topo / 2, topo].map((v) => (
          <g key={v}>
            <line x1={m.esquerda} x2={L - m.direita} y1={y(v)} y2={y(v)} className="grade" />
            <text x={m.esquerda - 8} y={y(v) + 4} textAnchor="end" className="eixo">
              {moedaCurta(v)}
            </text>
          </g>
        ))}
        {grupos.map((g, i) => {
          const cx = m.esquerda + (i + 0.5) * faixa;
          const h = base - y(g.total);
          const r = Math.min(4, coluna / 2, h);
          const [e, d, t] = [cx - coluna / 2, cx + coluna / 2, base - h];
          return (
            <g key={g.inicio} className="coluna-alvo">
              <title>{`${rotuloDoGrupo(g.inicio, granularidade)}: ${moeda(g.total)}`}</title>
              <rect
                x={m.esquerda + i * faixa}
                y={m.topo}
                width={faixa}
                height={altura}
                className="fundo-coluna"
              />
              {h > 0 && (
                <path
                  className="coluna"
                  d={`M${e},${base} V${t + r} Q${e},${t} ${e + r},${t} H${d - r} Q${d},${t} ${d},${t + r} V${base} Z`}
                />
              )}
              {i % passo === 0 && (
                <text x={cx} y={A - 6} textAnchor="middle" className="eixo">
                  {rotuloDoGrupo(g.inicio, granularidade, true)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/**
 * Ranking em lista: nome e valor na mesma linha, barra fina alinhada embaixo, todas
 * na mesma escala. Lê bem com muitos itens; o que passa de MAX_LINHAS vira "Outros".
 */
function Ranking({
  titulo,
  linhas,
  total,
  href,
}: {
  titulo: string;
  linhas: Linha[];
  total: number;
  href: (l: Linha) => string;
}) {
  const visiveis = linhas.slice(0, MAX_LINHAS);
  const resto = linhas.slice(MAX_LINHAS);
  const maior = Number(visiveis[0]?.total ?? 0);
  const outros = resto.reduce((s, l) => s + Number(l.total), 0);
  return (
    <section className="cartao">
      <h2 className="subtitulo">{titulo}</h2>
      <ul className="mt-4 grid gap-3.5">
        {visiveis.map((l) => (
          <li key={l.id ?? l.nome} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={href(l)} className="truncate hover:underline" title={`Filtrar: ${l.nome}`}>
                {l.nome}
              </Link>
              <span className="shrink-0 tabular-nums">
                {moeda(l.total)}
                <span className="ml-2 inline-block w-12 text-right text-suave">
                  {pct(Number(l.total), total)}
                </span>
              </span>
            </div>
            <div className="trilho mt-1.5">
              <div className="barra" style={{ width: `${(Number(l.total) / maior) * 100}%` }} />
            </div>
          </li>
        ))}
        {resto.length > 0 && (
          <li className="flex justify-between gap-3 border-t border-borda pt-3 text-sm text-suave">
            <span>Outros {resto.length}</span>
            <span className="tabular-nums">
              {moeda(outros)}
              <span className="ml-2 inline-block w-12 text-right">{pct(outros, total)}</span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

function LinhaProduto({
  l,
  posicao,
  total,
  maior,
}: {
  l: Linha;
  posicao: number;
  total: number;
  maior: number;
}) {
  return (
    <tr>
      <td className="w-8 text-suave tabular-nums">{posicao}</td>
      <td className="w-full max-w-0">
        <Link href={`/produtos/${l.id}`} className="block truncate hover:underline" title={l.nome}>
          {l.nome}
          {l.marca && <span className="text-suave"> · {l.marca}</span>}
        </Link>
      </td>
      <td className="hidden sm:table-cell">
        <div className="trilho w-28">
          <div className="barra" style={{ width: `${(Number(l.total) / maior) * 100}%` }} />
        </div>
      </td>
      <td className="numero">{moeda(l.total)}</td>
      <td className="numero text-suave">{pct(Number(l.total), total)}</td>
    </tr>
  );
}

function Produtos({ linhas, total }: { linhas: Linha[]; total: number }) {
  const maior = Number(linhas[0]?.total ?? 0);
  const linhasDe = (lista: Linha[], inicio: number) =>
    lista.map((l, i) => (
      <LinhaProduto key={l.id} l={l} posicao={inicio + i + 1} total={total} maior={maior} />
    ));
  return (
    <section className="cartao">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="subtitulo">Produtos com maior gasto</h2>
        <p className="text-sm text-suave">{linhas.length} produtos no período</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="tabela">
          <thead>
            <tr>
              <th>#</th>
              <th>Produto</th>
              <th className="hidden sm:table-cell" />
              <th className="numero">Gasto</th>
              <th className="numero">Parte</th>
            </tr>
          </thead>
          <tbody>{linhasDe(linhas.slice(0, MAX_PRODUTOS), 0)}</tbody>
        </table>
      </div>
      {linhas.length > MAX_PRODUTOS && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-primaria">
            Ver os outros {linhas.length - MAX_PRODUTOS}
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tabela">
              <tbody>{linhasDe(linhas.slice(MAX_PRODUTOS), MAX_PRODUTOS)}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

async function Painel({ busca }: { busca: PageProps<"/dashboard">["searchParams"] }) {
  const params = await busca;
  await connection(); // o período padrão depende de hoje: nunca vem do prerender
  const texto = (nome: string) => (typeof params[nome] === "string" ? (params[nome] as string) : "");
  const padrao = periodoPadrao();
  const filtros: Filtros = {
    from: texto("from") || padrao.from,
    to: texto("to") || padrao.to,
    category: texto("category"),
    store: texto("store"),
    q: texto("q"),
  };

  let resumo: Resumo;
  try {
    resumo = await api<Resumo>(`/dashboard/summary?${new URLSearchParams(filtros)}`);
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === "periodo_invalido") {
      return (
        <p className="cartao mt-6">
          Período inválido.{" "}
          <Link href="/dashboard" className="text-primaria underline">
            Voltar ao padrão
          </Link>
        </p>
      );
    }
    throw erro;
  }

  const total = Number(resumo.total);
  const maiorCategoria = resumo.por_categoria[0];

  return (
    <div className="mt-6 grid gap-4">
      <FormularioFiltros filtros={filtros} resumo={resumo} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <Indicador
            rotulo="Gasto no período"
            valor={moeda(resumo.total)}
            detalhe={<Variacao resumo={resumo} />}
          />
        </div>
        <Indicador
          rotulo="Cupons"
          valor={String(resumo.cupons)}
          detalhe={`${dataCurta(resumo.from)} a ${dataCurta(resumo.to)}`}
        />
        <Indicador
          rotulo="Ticket médio"
          valor={resumo.cupons ? moeda(total / resumo.cupons) : "—"}
          detalhe="por cupom"
        />
        <div className="col-span-2 lg:col-span-1">
          <Indicador
            rotulo="Maior categoria"
            texto
            valor={maiorCategoria?.nome ?? "—"}
            detalhe={
              maiorCategoria &&
              `${moeda(maiorCategoria.total)} · ${pct(Number(maiorCategoria.total), total)}`
            }
          />
        </div>
      </div>

      {resumo.por_produto.length === 0 ? (
        <p className="cartao text-suave">Nenhuma compra neste período com esses filtros.</p>
      ) : (
        <>
          <GraficoNoTempo resumo={resumo} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Ranking
              titulo="Por categoria"
              linhas={resumo.por_categoria}
              total={total}
              href={(l) => linkCom(filtros, { category: l.nome })}
            />
            <Ranking
              titulo="Por mercado"
              linhas={resumo.por_mercado}
              total={total}
              href={(l) => linkCom(filtros, { store: String(l.id) })}
            />
          </div>
          <Produtos linhas={resumo.por_produto} total={total} />
        </>
      )}
      <p className="text-xs text-suave">
        Soma dos itens normalizados: descontos gerais do cupom e itens em revisão não entram.
      </p>
    </div>
  );
}

/** Orçamentos que passaram de 80% no mês, com link para a página de gastos. */
async function AlertasDeOrcamento() {
  const alertas = (await api<Orcamento[]>("/budgets")).filter((o) => o.alerta);
  if (alertas.length === 0) return null;
  return (
    <div className="aviso flex flex-wrap items-center justify-between gap-2" role="status">
      <div>
        {alertas.map((o) => (
          <p key={o.categoria}>
            <strong>{o.categoria}</strong>: {moeda(o.gasto_mes)} de {moeda(o.valor)}
            {o.alerta === "estourou" ? ", orçamento estourado" : `, ${o.pct}% do orçamento`}
          </p>
        ))}
      </div>
      <Link href="/gastos" className="text-sm font-medium underline">
        Ver gastos
      </Link>
    </div>
  );
}

export default function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <h1 className="titulo">Dashboard</h1>
      <p className="mt-1 text-suave">Para onde vai o seu dinheiro no mercado.</p>
      <Suspense>
        <AlertasDeOrcamento />
      </Suspense>
      <Suspense fallback={<p className="mt-6 text-suave">Carregando…</p>}>
        <Painel busca={searchParams} />
      </Suspense>
    </>
  );
}
