import { createHmac } from "node:crypto";

// Mesmo formato que apps/api/src/auth/token.ts verifica: JWT HS256 com API_TOKEN_SECRET.
const CABECALHO = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");

export function assinarToken(dados: { sub: string; email?: string; nome?: string }, segredo: string) {
  const exp = Math.floor(Date.now() / 1000) + 60; // um minuto: vale só para a chamada
  const corpo = Buffer.from(JSON.stringify({ ...dados, exp })).toString("base64url");
  const assinatura = createHmac("sha256", segredo)
    .update(`${CABECALHO}.${corpo}`)
    .digest("base64url");
  return `${CABECALHO}.${corpo}.${assinatura}`;
}
