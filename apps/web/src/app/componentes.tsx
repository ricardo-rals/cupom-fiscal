"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useEffect } from "react";
import type { Estado } from "./actions";

export function Formulario({
  acao,
  botao,
  children,
  className,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  botao: string;
  children?: ReactNode;
  className?: string;
}) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  return (
    <form action={enviar} className={className}>
      {children}
      <div className="col-span-full flex items-center gap-3">
        <button className="botao" disabled={enviando}>
          {enviando ? "Enviando…" : botao}
        </button>
        <p aria-live="polite" className={estado.erro ? "text-sm text-erro" : "text-sm text-suave"}>
          {estado.erro ?? estado.aviso}
        </p>
      </div>
    </form>
  );
}

/** Busca o cupom de novo enquanto a normalização roda em segundo plano. */
export function Atualizador() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
