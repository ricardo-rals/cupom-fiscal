import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Campo } from "@/app/campos";
import { api, ErroApi } from "@/lib/api";
import { dataCurta, moeda } from "@/lib/formato";
import { periodoPadrao } from "@/lib/grafico";

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
  por_categoria: Linha[];
  por_mercado: Linha[];
  por_produto: Linha[];
  opcoes: { categorias: string[]; mercados: { id: number; nome: string }[] };
}

function Barras({ titulo, linhas, link }: { titulo: string; linhas: Linha[]; link?: boolean }) {
  const maior = Math.max(...linhas.map((l) => Number(l.total)));
  return (
    <section className="mt-8">
      <h2 className="subtitulo mb-2">{titulo}</h2>
      <ul className="grid gap-2">
        {linhas.map((l) => (
          <li key={l.id ?? l.nome} className="text-sm">
            <div className="flex justify-between gap-4">
              {link ? (
                <Link href={`/produtos/${l.id}`} className="underline">
                  {l.nome}
                  {l.marca && ` · ${l.marca}`}
                </Link>
              ) : (
                <span>{l.nome}</span>
              )}
              <span className="tabular-nums">{moeda(l.total)}</span>
            </div>
            <div className="barra" style={{ width: `${(Number(l.total) / maior) * 100}%` }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comparacao({ resumo }: { resumo: Resumo }) {
  const { anterior } = resumo;
  const periodo = `${dataCurta(anterior.from)} a ${dataCurta(anterior.to)}`;
  if (anterior.variacao_pct === null) {
    return <p className="mt-1 text-suave">Sem compras no período anterior ({periodo}).</p>;
  }
  const variacao = Number(anterior.variacao_pct);
  const sinal = variacao > 0 ? "▲ +" : variacao < 0 ? "▼ " : "";
  return (
    <p className="mt-1 text-suave">
      {sinal}
      {variacao.toLocaleString("pt-BR")}% em relação ao período anterior: {moeda(anterior.total)},
      de {periodo}.
    </p>
  );
}

async function Painel({ busca }: { busca: PageProps<"/dashboard">["searchParams"] }) {
  const params = await busca;
  await connection(); // o período padrão depende de hoje: nunca vem do prerender
  const texto = (nome: string) => (typeof params[nome] === "string" ? (params[nome] as string) : "");
  const padrao = periodoPadrao();
  const filtros = {
    from: texto("from") || padrao.from,
    to: texto("to") || padrao.to,
    category: texto("category"),
    store: texto("store"),
  };

  let resumo: Resumo;
  try {
    resumo = await api<Resumo>(`/dashboard/summary?${new URLSearchParams(filtros)}`);
  } catch (erro) {
    if (erro instanceof ErroApi && erro.codigo === "periodo_invalido") {
      return (
        <p className="mt-4">
          Período inválido.{" "}
          <Link href="/dashboard" className="underline">
            Voltar ao padrão
          </Link>
        </p>
      );
    }
    throw erro;
  }

  return (
    <>
      <form className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
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
        <div className="col-span-full">
          <button className="botao">Filtrar</button>
        </div>
      </form>

      <section className="mt-8">
        <p className="text-sm text-suave">
          Gasto de {dataCurta(resumo.from)} a {dataCurta(resumo.to)} · {resumo.cupons}{" "}
          {resumo.cupons === 1 ? "cupom" : "cupons"}
        </p>
        <p className="text-4xl font-semibold tabular-nums">{moeda(resumo.total)}</p>
        <Comparacao resumo={resumo} />
        <p className="mt-2 text-sm text-suave">
          Soma dos itens normalizados: descontos gerais do cupom e itens em revisão não entram.
        </p>
      </section>

      {resumo.por_produto.length === 0 ? (
        <p className="mt-8 text-suave">Nenhuma compra neste período.</p>
      ) : (
        <>
          <Barras titulo="Por categoria" linhas={resumo.por_categoria} />
          <Barras titulo="Por mercado" linhas={resumo.por_mercado} />
          <Barras
            titulo={
              resumo.por_produto.length > MAX_PRODUTOS
                ? `Os ${MAX_PRODUTOS} produtos com maior gasto, de ${resumo.por_produto.length}`
                : "Por produto"
            }
            linhas={resumo.por_produto.slice(0, MAX_PRODUTOS)}
            link
          />
        </>
      )}
    </>
  );
}

export default function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  return (
    <>
      <h1 className="titulo">Dashboard</h1>
      <Suspense fallback={<p className="mt-4 text-suave">Carregando…</p>}>
        <Painel busca={searchParams} />
      </Suspense>
    </>
  );
}
