import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token curto que o web assina para cada chamada à api, depois do login Google.
 * Formato JWT HS256, com a mesma chave API_TOKEN_SECRET nos dois lados.
 */
export interface DadosDoToken {
  sub: string; // id da conta Google
  email?: string;
  nome?: string;
}

const CABECALHO = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
  'base64url',
);

const assinatura = (conteudo: string, segredo: string) =>
  createHmac('sha256', segredo).update(conteudo).digest('base64url');

export function assinarToken(
  dados: DadosDoToken,
  segredo: string,
  validadeS = 60,
) {
  const corpo = Buffer.from(
    JSON.stringify({
      ...dados,
      exp: Math.floor(Date.now() / 1000) + validadeS,
    }),
  ).toString('base64url');
  return `${CABECALHO}.${corpo}.${assinatura(`${CABECALHO}.${corpo}`, segredo)}`;
}

/** Devolve null para qualquer coisa fora do formato, assinatura errada ou prazo vencido. */
export function verificarToken(
  token: string,
  segredo: string,
): DadosDoToken | null {
  const [cabecalho, corpo, recebida, ...resto] = token.split('.');
  if (cabecalho !== CABECALHO || !corpo || !recebida || resto.length)
    return null;
  const esperada = Buffer.from(assinatura(`${cabecalho}.${corpo}`, segredo));
  const veio = Buffer.from(recebida);
  if (veio.length !== esperada.length || !timingSafeEqual(veio, esperada))
    return null;

  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);
  if (
    typeof dados.exp !== 'number' ||
    dados.exp * 1000 < Date.now() ||
    !texto(dados.sub)
  )
    return null;
  return {
    sub: dados.sub as string,
    email: texto(dados.email),
    nome: texto(dados.nome),
  };
}
