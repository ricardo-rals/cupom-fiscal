import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { definirOrcamento } from "@/app/actions";
import { Campo } from "@/app/campos";
import { Formulario } from "@/app/componentes";
import { api, type Orcamento, type PrevisaoGasto, type Sugestao } from "@/lib/api";
import { moeda } from "@/lib/formato";

const ALERTA = { perto: "▲ passou de 80%", estourou: "● estourou" };

/** Quanto já foi gasto de um limite: trilho claro, barra vermelha quando passa. */
function Medidor({ gasto, limite }: { gasto: number; limite: number }) {
  const pct = limite > 0 ? Math.min((gasto / limite) * 100, 100) : 0;
  return (
    <div className="trilho mt-2" aria-hidden>
      <div className={`barra ${gasto > limite ? "barra-estouro" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Card que abre: o resumo fica sempre à vista, os detalhes aparecem ao clicar. */
function Cartao({
  rotulo,
  valor,
  detalhe,
  medidor,
  aberto,
  children,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe: ReactNode;
  medidor?: ReactNode;
  aberto?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="cartao" open={aberto}>
      <summary className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="rotulo">{rotulo}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{valor}</p>
          <p className="mt-1 text-sm text-suave">{detalhe}</p>
          {medidor}
        </div>
        <span className="seta mt-1 text-suave" aria-hidden>
          ›
        </span>
      </summary>
      <div className="mt-4 border-t border-borda pt-4">{children}</div>
    </details>
  );
}

async function Previsao() {
  const p = await api<PrevisaoGasto>("/spending/forecast");
  const metodo = p.total.metodo.startsWith("media")
    ? `Média dos últimos 3 meses. O modelo de previsão pede 6 meses com compra; há ${p.meses_com_compra}.`
    : `Modelo ${p.total.metodo}, com 80% de chance entre ${moeda(p.total.inferior ?? 0)} e ${moeda(p.total.superior ?? 0)}.`;
  return (
    <Cartao
      rotulo={`Previsão para ${new Date(`${p.mes}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}`}
      valor={moeda(p.total.previsto)}
      detalhe={`${moeda(p.total.gasto_ate_agora)} gastos até agora`}
      medidor={<Medidor gasto={p.total.gasto_ate_agora} limite={p.total.previsto} />}
    >
      <p className="text-sm text-suave">{metodo}</p>
      {p.categorias.length === 0 ? (
        <p className="mt-3 text-sm text-suave">Sem histórico por categoria ainda.</p>
      ) : (
        <ul className="mt-4 grid gap-3.5 sm:grid-cols-2 sm:gap-x-8">
          {p.categorias.map((c) => {
            const limite = c.orcamento ?? c.previsto;
            return (
              <li key={c.categoria} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="truncate">{c.categoria}</span>
                  <span className="shrink-0 tabular-nums text-suave">
                    {moeda(c.gasto_ate_agora)} de {moeda(limite)}
                    {c.orcamento !== null && " (orçamento)"}
                  </span>
                </div>
                <Medidor gasto={c.gasto_ate_agora} limite={limite} />
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

async function Orcamentos() {
  const [orcamentos, categorias] = await Promise.all([
    api<Orcamento[]>("/budgets"),
    api<string[]>("/review-queue/categories"),
  ]);
  const alertas = orcamentos.filter((o) => o.alerta).length;
  const total = orcamentos.reduce((s, o) => s + o.valor, 0);
  const gasto = orcamentos.reduce((s, o) => s + o.gasto_mes, 0);
  return (
    <Cartao
      rotulo="Orçamento mensal"
      valor={orcamentos.length ? moeda(total) : "Nenhum"}
      detalhe={
        orcamentos.length ? (
          <>
            {moeda(gasto)} gastos em {orcamentos.length}{" "}
            {orcamentos.length === 1 ? "categoria" : "categorias"}
            {alertas > 0 && (
              <strong className="text-erro">
                {" "}
                · {alertas} {alertas === 1 ? "alerta" : "alertas"}
              </strong>
            )}
          </>
        ) : (
          "Defina um limite por categoria e receba alerta ao passar de 80%."
        )
      }
      medidor={orcamentos.length > 0 && <Medidor gasto={gasto} limite={total} />}
      aberto={alertas > 0}
    >
      {orcamentos.length > 0 && (
        <ul className="grid gap-3.5 sm:grid-cols-2 sm:gap-x-8">
          {orcamentos.map((o) => (
            <li key={o.categoria} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate">
                  {o.categoria}
                  {o.alerta && <strong className="text-erro"> {ALERTA[o.alerta]}</strong>}
                </span>
                <span className="shrink-0 tabular-nums text-suave">
                  {moeda(o.gasto_mes)} de {moeda(o.valor)} ({o.pct}%)
                </span>
              </div>
              <Medidor gasto={o.gasto_mes} limite={o.valor} />
            </li>
          ))}
        </ul>
      )}
      <h3 className="subtitulo mt-6 text-sm">Definir ou alterar</h3>
      <Formulario
        acao={definirOrcamento}
        botao="Salvar orçamento"
        className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
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
    </Cartao>
  );
}

async function Lista() {
  const lista = await api<Sugestao[]>("/shopping-list");
  const estimado = lista.reduce((s, i) => s + i.preco_esperado, 0);
  return (
    <Cartao
      rotulo="Lista de compras sugerida"
      valor={lista.length ? `${lista.length} ${lista.length === 1 ? "item" : "itens"}` : "Vazia"}
      detalhe={
        lista.length
          ? `Cerca de ${moeda(estimado)} · produtos que você costuma comprar e estão perto de acabar`
          : "Nada perto de acabar. Entram produtos comprados pelo menos 3 vezes."
      }
    >
      {lista.length === 0 ? (
        <p className="text-sm text-suave">
          A lista aparece quando um produto comprado pelo menos 3 vezes chega perto do intervalo de
          sempre.
        </p>
      ) : (
        <ul className="divide-y divide-borda text-sm">
          {lista.map((s) => (
            <li key={s.produto}>
              <label className="flex cursor-pointer items-start gap-3 py-2.5">
                <input type="checkbox" className="mt-1 size-4 accent-primaria" />
                <span className="min-w-0 flex-1">
                  <Link href={`/produtos/${s.produto}`} className="font-medium hover:underline">
                    {s.nome}
                    {s.marca && <span className="font-normal text-suave"> · {s.marca}</span>}
                  </Link>
                  <span className="block text-suave">
                    A cada {s.intervalo_dias} dias; a última foi há {s.dias_desde_a_ultima}.
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {moeda(s.preco_esperado)}
                  <span className="block text-suave">qtd. {Number(s.quantidade.toFixed(3))}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

const carregando = <div className="cartao h-28 animate-pulse" aria-label="Carregando" />;

export default function Gastos() {
  return (
    <>
      <h1 className="titulo">Gastos</h1>
      <p className="mt-1 text-suave">Previsão do mês, orçamentos e o que comprar. Clique para abrir.</p>
      <div className="mt-6 grid gap-4">
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
