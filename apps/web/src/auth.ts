import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Sessão em cookie JWT, sem tabela: quem guarda o usuário é a api, pelo id da conta Google.
// Lê AUTH_SECRET, AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET do ambiente.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: "/login" },
  trustHost: true, // atrás do compose o host vem do cabeçalho da requisição
  callbacks: {
    // token.sub é o id da conta Google; a sessão não o expõe por padrão.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
