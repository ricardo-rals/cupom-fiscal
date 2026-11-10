"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", rotulo: "Cupons" },
  { href: "/dashboard", rotulo: "Dashboard" },
  { href: "/gastos", rotulo: "Gastos" },
  { href: "/perguntas", rotulo: "Perguntas" },
  { href: "/revisao", rotulo: "Revisão" },
];

const ativo = (href: string, atual: string) =>
  href === "/" ? /^\/(cupons|compras|$)/.test(atual) : atual.startsWith(href);

/** Os links; `atual` vazio (no prerender) não marca nenhum. */
export function Links({ atual = "" }: { atual?: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="nav-link"
          aria-current={atual && ativo(l.href, atual) ? "page" : undefined}
        >
          {l.rotulo}
        </Link>
      ))}
    </div>
  );
}

export function Navegacao() {
  return <Links atual={usePathname()} />;
}
