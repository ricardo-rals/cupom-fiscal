import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  confirmar,
  corrigirItem,
  excluirCupom,
  excluirItem,
  incluirItem,
  retomar,
  salvarCupom,
  salvarItem,
} from "@/app/actions";
import { Campo, CamposNormalizacao } from "@/app/campos";
import { Atualizador, Formulario } from "@/app/componentes";
import { CamposItem } from "@/app/itens";
import { api, type Cupom, ErroApi, type ItemCupom } from "@/lib/api";
import { dataHora, moeda, paraCampoData } from "@/lib/formato";

const GRADE = "mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2";

function Situacao({ cupom }: { cupom: Cupom }) {
  if (cupom.status === "rascunho") {
    return (
      <div className="aviso">
        <p>
          Lido da foto. Confira mercado, data e itens: corrija, inclua o que faltou e exclua o que
          veio errado. Só depois de confirmar os itens entram nos gastos.
        </p>
        <Formulario acao={confirmar.bind(null, cupom.id)} botao="Confirmar cupom" className="mt-2" />
      </div>
    );
  }
  if (cupom.parada) {
    return (
      <div className="aviso">
        <p>A normalização parou depois de várias tentativas, e os itens prontos estão salvos.</p>
        <Formulario acao={retomar.bind(null, cupom.id)} botao="Tentar de novo" className="mt-2" />
      </div>
    );
  }
  if (cupom.status === "confirmado") {
    return (
      <p className="aviso" aria-live="polite">
        Normalizando os itens… esta página atualiza sozinha.
        <Atualizador />
      </p>
    );
  }
  if (cupom.em_revisao > 0) {
    return <p className="aviso">{cupom.em_revisao} itens aguardam revisão.</p>;
  }
  return null;
}

function Item({
  cupomId,
  item,
  categorias,
}: {
  cupomId: number;
  item: ItemCupom;
  categorias: string[];
}) {
  const n = item.normalizacao;
  return (
    <details className="border-b border-borda py-3">
      <summary className="cursor-pointer">
        <span className="font-medium">{item.descricao_original}</span>{" "}
        <span className="tabular-nums text-suave">{moeda(item.valor_total)}</span>
        <span className="block text-sm text-suave">
          {n
            ? `${n.produto}${n.marca && ` · ${n.marca}`} · ${Number(n.conteudo)} ${n.unidade_padrao} · ${n.categoria}`
            : item.origem
              ? "Sem sugestão"
              : "Normalizando…"}
          {item.em_revisao && " · em revisão"}
        </span>
      </summary>

      <h3 className="subtitulo mt-3">Dados do cupom</h3>
      <Formulario
        acao={salvarItem.bind(null, cupomId, item.id)}
        botao="Salvar item"
        className={GRADE}
      >
        <div className="col-span-full">
          <Campo
            rotulo="Descrição"
            name="descricao_original"
            defaultValue={item.descricao_original}
            required
          />
          <p className="mt-1 text-xs text-suave">Mudar a descrição normaliza o item de novo.</p>
        </div>
        <Campo rotulo="Código" name="codigo" defaultValue={item.codigo ?? ""} />
        <Campo rotulo="Unidade" name="unidade" defaultValue={item.unidade} required />
        <Campo
          rotulo="Quantidade"
          name="quantidade"
          inputMode="decimal"
          defaultValue={Number(item.quantidade)}
          required
        />
        <Campo
          rotulo="Valor unitário"
          name="valor_unitario"
          inputMode="decimal"
          defaultValue={Number(item.valor_unitario)}
          required
        />
        <Campo
          rotulo="Valor total"
          name="valor_total"
          inputMode="decimal"
          defaultValue={Number(item.valor_total).toFixed(2)}
          required
        />
      </Formulario>

      {item.origem && (
        <>
          <h3 className="subtitulo mt-4">Normalização</h3>
          <Formulario acao={corrigirItem.bind(null, item.id)} botao="Corrigir" className={GRADE}>
            <CamposNormalizacao atual={n} categorias={categorias} />
          </Formulario>
        </>
      )}

      <Formulario
        acao={excluirItem.bind(null, cupomId, item.id)}
        botao="Excluir item"
        className="mt-4"
      />
    </details>
  );
}

async function Detalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [cupom, categorias] = await Promise.all([
    api<Cupom>(`/receipts/${id}`).catch((erro) => {
      if (erro instanceof ErroApi && erro.codigo === "cupom_nao_encontrado") notFound();
      throw erro;
    }),
    api<string[]>("/review-queue/categories"),
  ]);

  return (
    <>
      <h1 className="titulo">{cupom.mercado}</h1>
      <p className="mt-1 text-suave">
        {dataHora(cupom.emitido_em)} · {moeda(cupom.total)}
      </p>
      <Situacao cupom={cupom} />

      <details className="mt-6">
        <summary className="subtitulo cursor-pointer">Editar dados do cupom</summary>
        <p className="mt-3 break-all text-sm text-suave">
          {cupom.origem === "manual"
            ? "Compra sem nota"
            : `CNPJ ${cupom.cnpj} · Chave ${cupom.chave_acesso}`}
        </p>
        <Formulario acao={salvarCupom.bind(null, cupom.id)} botao="Salvar cupom" className={GRADE}>
          <Campo rotulo="Mercado" name="mercado" defaultValue={cupom.mercado} required />
          <Campo
            rotulo="Emissão"
            name="emitido_em"
            type="datetime-local"
            step={1}
            defaultValue={paraCampoData(cupom.emitido_em)}
            required
          />
          <Campo
            rotulo="Total"
            name="total"
            inputMode="decimal"
            defaultValue={Number(cupom.total).toFixed(2)}
            required
          />
          <Campo
            rotulo="Desconto"
            name="desconto"
            inputMode="decimal"
            defaultValue={Number(cupom.desconto).toFixed(2)}
            required
          />
          <Campo
            rotulo="Acréscimo"
            name="acrescimo"
            inputMode="decimal"
            defaultValue={Number(cupom.acrescimo).toFixed(2)}
            required
          />
          <Campo rotulo="Pagamento" name="pagamento" defaultValue={cupom.pagamento ?? ""} />
        </Formulario>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-erro">Excluir este cupom</summary>
          <p className="mt-2 text-sm text-suave">
            O cupom e os {cupom.itens} itens somem dos gastos e das previsões. Não dá para desfazer.
          </p>
          <Formulario
            acao={excluirCupom.bind(null, cupom.id)}
            botao="Excluir cupom e itens"
            className="mt-2"
          />
        </details>
      </details>

      <h2 className="subtitulo mt-8">{cupom.itens} itens</h2>
      {cupom.lista.map((item) => (
        <Item key={item.id} cupomId={cupom.id} item={item} categorias={categorias} />
      ))}

      <details className="mt-6">
        <summary className="subtitulo cursor-pointer">Incluir item</summary>
        <Formulario
          acao={incluirItem.bind(null, cupom.id)}
          botao="Incluir item"
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <CamposItem />
        </Formulario>
      </details>
    </>
  );
}

export default function PaginaCupom({ params }: PageProps<"/cupons/[id]">) {
  return (
    <Suspense fallback={<p className="text-suave">Carregando…</p>}>
      <Detalhe params={params} />
    </Suspense>
  );
}
