import { Pergunta } from "./pergunta";

export default function Perguntas() {
  return (
    <>
      <h1 className="titulo">Pergunte aos seus gastos</h1>
      <p className="mt-1 text-suave">
        Por exemplo: quanto gastei com bebidas no mês passado? Em qual mercado o leite saiu mais
        barato?
      </p>
      <Pergunta />
    </>
  );
}
