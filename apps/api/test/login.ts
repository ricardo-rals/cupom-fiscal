import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { assinarToken, DadosDoToken } from '../src/auth/token.js';

/** Os testes rodam como o dono: o usuário 1, criado pela migration, assumido pelo OWNER_EMAIL. */
export const DONO = 1;
const DADOS_DO_DONO: DadosDoToken = {
  sub: 'teste-dono',
  email: 'dono@teste.local',
  nome: 'Dono',
};

/** Como o supertest, mas cada requisição leva o token que o web assinaria depois do login. */
export function comLogin(app: INestApplication<App>, dados = DADOS_DO_DONO) {
  const http = request(app.getHttpServer());
  const token = () =>
    `Bearer ${assinarToken(dados, process.env.API_TOKEN_SECRET!)}`;
  return {
    get: (url: string) => http.get(url).set('Authorization', token()),
    post: (url: string) => http.post(url).set('Authorization', token()),
    patch: (url: string) => http.patch(url).set('Authorization', token()),
    put: (url: string) => http.put(url).set('Authorization', token()),
    delete: (url: string) => http.delete(url).set('Authorization', token()),
  };
}
