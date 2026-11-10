import Link from "next/link";
import { Suspense } from "react";
import { api, type ResumoCupom } from "@/lib/api";
import { dataHora, moeda } from "@/lib/formato";
import { importar, importarFoto } from "./actions";
import { Campo } from "./campos";
import { Formulario } from "./componentes";
import { UsarIa } from "./usar-ia";

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
    <ul className="cartao divide-y divide-borda py-1">
      {cupons.map((c) => (
        <li key={c.id}>
          <Link
            href={`/cupons/${c.id}`}
            className="group flex flex-wrap items-baseline justify-between gap-x-4 py-3"
          >
            <span className="font-medium group-hover:text-primaria">{c.mercado}</span>
            <span className="font-medium tabular-nums">{moeda(c.total)}</span>
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

export default function Inicio() {
  return (
    <>
      <h1 className="titulo">Cupons</h1>
      <p className="mt-1 text-suave">Importe uma NFC-e pelo link do QR code ou por uma foto.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="cartao">
          <h2 className="subtitulo">Pelo link do QR code</h2>
          <Formulario acao={importar} botao="Importar" className="mt-3 grid gap-3">
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
        </section>

        <section className="cartao">
          <h2 className="subtitulo">Pela foto do cupom</h2>
          <p className="mt-1 text-sm text-suave">
            Se a foto mostrar o QR code, o cupom vem da Sefaz. Sem QR, o texto é lido e você confere
            antes de confirmar. A foto não fica guardada.
          </p>
          <Formulario acao={importarFoto} botao="Enviar foto" className="mt-3 grid gap-3">
            <input
              type="file"
              name="foto"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              required
              aria-label="Foto do cupom"
            />
            <Suspense>
              <UsarIa />
            </Suspense>
          </Formulario>
        </section>
      </div>

      <p className="mt-4 text-sm text-suave">
        Comprou sem nota?{" "}
        <Link href="/compras/nova" className="font-medium text-primaria underline">
          Lançar compra
        </Link>
      </p>

      <h2 className="subtitulo mt-10 mb-3">Histórico</h2>
      <Suspense fallback={<p className="text-suave">Carregando…</p>}>
        <Cupons />
      </Suspense>
    </>
  );
}
