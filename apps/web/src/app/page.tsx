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

      <h2 className="subtitulo mt-8">Ou pela foto do cupom</h2>
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

      <p className="mt-6 text-sm">
        Comprou sem nota?{" "}
        <Link href="/compras/nova" className="underline">
          Lançar compra
        </Link>
      </p>

      <h2 className="subtitulo mt-10 mb-2">Cupons</h2>
      <Suspense fallback={<p className="text-suave">Carregando…</p>}>
        <Cupons />
      </Suspense>
    </>
  );
}
