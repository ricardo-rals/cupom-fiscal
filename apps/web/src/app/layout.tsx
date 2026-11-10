import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import "./globals.css";
import { Links, Navegacao } from "./navegacao";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cupom fiscal",
  description: "Controle de compras por cupom fiscal com IA",
};

async function Conta() {
  const sessao = await auth();
  if (!sessao?.user) return null;
  return (
    <form
      className="ml-auto flex items-center gap-3 text-sm text-suave"
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <span className="hidden sm:inline">{sessao.user.name ?? sessao.user.email}</span>
      <button type="submit" className="underline">
        Sair
      </button>
    </form>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="sticky top-0 z-10 border-b border-borda bg-cartao/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-lg bg-primaria text-white"
              >
                {/* Cupom com borda serrilhada */}
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" strokeLinejoin="round" />
                  <path d="M6 5.5h4M6 8h4" strokeLinecap="round" />
                </svg>
              </span>
              Cupom fiscal
            </Link>
            <Suspense fallback={<Links />}>
              <Navegacao />
            </Suspense>
            <Suspense>
              <Conta />
            </Suspense>
          </div>
        </nav>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
