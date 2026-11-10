import { signIn } from "@/auth";

export default function Login() {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <h1 className="titulo">Entrar</h1>
      <p className="mt-2 text-suave">Cada conta vê só os próprios cupons e gastos.</p>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit" className="botao w-full">
          Entrar com Google
        </button>
      </form>
    </div>
  );
}
