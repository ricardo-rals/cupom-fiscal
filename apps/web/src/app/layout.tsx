import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import "./globals.css";

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
        <nav className="border-b border-borda">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="font-semibold">
              Cupom fiscal
            </Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/gastos">Gastos</Link>
            <Link href="/perguntas">Perguntas</Link>
            <Link href="/revisao">Revisão</Link>
            <Suspense>
              <Conta />
            </Suspense>
          </div>
        </nav>
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
