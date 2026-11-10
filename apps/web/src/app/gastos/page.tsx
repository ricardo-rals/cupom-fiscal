import Link from "next/link";
import { Suspense } from "react";
import { definirOrcamento } from "@/app/actions";
import { Campo } from "@/app/campos";
import { Formulario } from "@/app/componentes";
import { api, type Orcamento, type PrevisaoGasto, type Sugestao } from "@/lib/api";
import { moeda } from "@/lib/formato";

const ALERTA = { perto: "passou de 80%", estourou: "estourou" };

/** Barra de quanto do orçamento (ou da previsão) já foi gasto. */
function Barra({ gasto, limite }: { gasto: number; limite: number }) {
  const pct = limite > 0 ? Math.min((gasto / limite) * 100, 100) : 0;
  return (
    <div className="mt-1 h-2 rounded bg-borda" aria-hidden>
      <div
        className={`h-2 rounded ${gasto > limite ? "bg-erro" : "bg-foreground"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

async function Previsao() {
  const p = await api<PrevisaoGasto>("/spending/forecast");
  const metodo = p.total.metodo.startsWith("media")
    ? `média dos últimos 3 meses (o modelo de previsão pede 6 meses com compra; há ${p.meses_com_compra})`
    : `modelo ${p.total.metodo}, com 80% de chance entre ${moeda(p.total.inferior ?? 0)} e ${moeda(p.total.superior ?? 0)}`;
  return (
    <section>
      <h2 className="subtitulo">Previsão para {p.mes}</h2>
      <p className="mt-1 text-2xl tabular-nums">{moeda(p.total.previsto)}</p>
      <p className="text-sm text-suave">
        Gasto até agora: {moeda(p.total.gasto_ate_agora)} · {metodo}
      </p>
      <Barra gasto={p.total.gasto_ate_agora} limite={p.total.previsto} />
      {p.categorias.length > 0 && (
        <ul className="mt-4 grid gap-3">
          {p.categorias.map((c) => (
            <li key={c.categoria} className="text-sm">
              <div className="flex flex-wrap justify-between gap-x-4">
                <span>{c.categoria}</span>
                <span className="tabular-nums text-suave">
                  {moeda(c.gasto_ate_agora)} de {moeda(c.orcamento ?? c.previsto)}
                  {c.orcamento !== null ? " (orçamento)" : " (previsto)"}
                </span>
              </div>
              <Barra gasto={c.gasto_ate_agora} limite={c.orcamento ?? c.previsto} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Orcamentos() {
  const [orcamentos, categorias] = await Promise.all([
    api<Orcamento[]>("/budgets"),
    api<string[]>("/review-queue/categories"),
  ]);
  return (
    <section>
      <h2 className="subtitulo">Orçamento mensal</h2>
      {orcamentos.length === 0 ? (
        <p className="mt-1 text-sm text-suave">Nenhum orçamento ainda. Defina um abaixo.</p>
      ) : (
        <ul className="mt-2 grid gap-1 text-sm">
          {orcamentos.map((o) => (
            <li key={o.categoria} className="flex flex-wrap justify-between gap-x-4">
              <span>
                {o.categoria}
                {o.alerta && <strong className="text-erro"> · {ALERTA[o.alerta]}</strong>}
              </span>
              <span className="tabular-nums">
                {moeda(o.gasto_mes)} de {moeda(o.valor)} ({o.pct}%)
              </span>
            </li>
          ))}
        </ul>
      )}
      <Formulario
        acao={definirOrcamento}
        botao="Salvar orçamento"
        className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <label className="campo">
          Categoria
          <select name="categoria" required defaultValue="">
            <option value="" disabled>
              Escolha…
            </option>
            {categorias.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <Campo rotulo="Valor por mês (0 remove)" name="valor" inputMode="decimal" required />
      </Formulario>
    </section>
  );
}

async function Lista() {
  const lista = await api<Sugestao[]>("/shopping-list");
  return (
    <section>
      <h2 className="subtitulo">Lista de compras sugerida</h2>
      <p className="mt-1 text-sm text-suave">
        Produtos comprados pelo menos 3 vezes cujo intervalo de sempre está acabando.
      </p>
      {lista.length === 0 ? (
        <p className="mt-2 text-sm text-suave">Nada perto de acabar por enquanto.</p>
      ) : (
        <ul className="mt-2 divide-y divide-borda text-sm">
          {lista.map((s) => (
            <li key={s.produto} className="flex flex-wrap justify-between gap-x-4 py-2">
              <Link href={`/produtos/${s.produto}`} className="font-medium hover:underline">
                {s.nome}
                {s.marca && ` · ${s.marca}`}
              </Link>
              <span className="tabular-nums">
                {Number(s.quantidade.toFixed(3))} · cerca de {moeda(s.preco_esperado)}
              </span>
              <span className="w-full text-suave">
                Compra a cada {s.intervalo_dias} dias; a última foi há {s.dias_desde_a_ultima}.
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const carregando = <p className="text-suave">Carregando…</p>;

export default function Gastos() {
  return (
    <>
      <h1 className="titulo">Gastos</h1>
      <div className="mt-6 grid gap-10">
        <Suspense fallback={carregando}>
          <Previsao />
        </Suspense>
        <Suspense fallback={carregando}>
          <Orcamentos />
        </Suspense>
        <Suspense fallback={carregando}>
          <Lista />
        </Suspense>
      </div>
    </>
  );
}
