import Link from "next/link";
import { Suspense } from "react";
import { api, type ResumoCupom } from "@/lib/api";
import { dataHora, moeda } from "@/lib/formato";
import { importar } from "./actions";
import { Campo } from "./campos";
import { Formulario } from "./componentes";

const STATUS = {
  rascunho: "Rascunho",
  confirmado: "Normalizando",
  normalizado: "Pronto",
};

async function Cupons() {
  const cupons = await api<ResumoCupom[]>("/receipts");
  if (cupons.length === 0) {
    return <p className="text-suave">Nenhum cupom ainda. Importe o primeiro acima.</p>;
  }
  return (
    <ul className="divide-y divide-borda">
      {cupons.map((c) => (
        <li key={c.id}>
          <Link
            href={`/cupons/${c.id}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 hover:underline"
          >
            <span className="font-medium">{c.mercado}</span>
            <span className="tabular-nums">{moeda(c.total)}</span>
            <span className="w-full text-sm text-suave">
              {dataHora(c.emitido_em)} · {c.itens} itens · {STATUS[c.status]}
              {c.em_revisao > 0 && ` · ${c.em_revisao} em revisão`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A caixa já vem com a última escolha do usuário. */
async function UsarIa() {
  const { usar_ia } = await api<{ usar_ia: boolean }>("/me");
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="usar_ia" defaultChecked={usar_ia} />
      Usar IA para reconhecer os produtos
      <span className="text-suave">(sem IA é grátis e instantâneo, mas menos preciso)</span>
    </label>
  );
}

export default function Inicio() {
  return (
    <>
      <h1 className="titulo">Importar cupom</h1>
      <Formulario acao={importar} botao="Importar" className="mt-4 grid gap-3">
        <Campo
          rotulo="URL do QR code da NFC-e"
          name="url"
          type="text"
          maxLength={2048}
          placeholder="http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=…"
          required
        />
        <Suspense>
          <UsarIa />
        </Suspense>
      </Formulario>

      <h2 className="subtitulo mt-10 mb-2">Cupons</h2>
      <Suspense fallback={<p className="text-suave">Carregando…</p>}>
        <Cupons />
      </Suspense>
    </>
  );
}
