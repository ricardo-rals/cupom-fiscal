"use client";

export default function Erro({ reset }: { reset: () => void }) {
  return (
    <>
      <h1 className="titulo">Não foi possível carregar</h1>
      <p className="mt-2 text-suave">A api pode estar fora do ar.</p>
      <button className="botao mt-4" onClick={reset}>
        Tentar de novo
      </button>
    </>
  );
}
