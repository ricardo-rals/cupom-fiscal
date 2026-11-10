import { auth } from "@/auth";

// Sem sessão, qualquer página leva ao login. A api confere de novo pelo token de cada chamada.
export default auth((requisicao) => {
  if (!requisicao.auth) return Response.redirect(new URL("/login", requisicao.nextUrl));
});

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
