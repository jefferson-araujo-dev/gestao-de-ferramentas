import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertResponsiveLocalEnvironment,
  classifyResponsiveRequest,
  describeViolation,
} from '../responsive/support/network-policy.mjs';

// Política fail-closed da suíte responsiva. URLs remotas são apenas strings simuladas:
// nada aqui abre conexão de rede.
describe('classifyResponsiveRequest', () => {
  const blocked = [
    [
      'https://firestore.googleapis.com/v1/projects/x/databases/(default)/documents',
      'Firestore remoto',
    ],
    ['https://identitytoolkit.googleapis.com/v1/accounts:lookup', 'Firebase Auth remoto'],
    ['https://securetoken.googleapis.com/v1/token', 'Firebase Auth remoto'],
    ['https://us-central1-x.cloudfunctions.net/fn', 'Firebase Functions real'],
    ['https://x-default-rtdb.firebaseio.com/.json', 'Firebase Realtime Database'],
    ['https://x.firebaseapp.com/__/auth/handler', 'Firebase Hosting'],
    ['https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig', 'API Google'],
    ['https://gestao.vercel.app/api/backup/restore', 'Vercel real'],
    ['wss://firestore.googleapis.com/channel', 'Firestore remoto'],
    ['https://outro-host.example/x', 'host fora da allowlist'],
    ['http://127.0.0.1:3100/api/session/last-login', 'API do projeto (/api/*)'],
    ['http://localhost:3100/api/tools/movement', 'API do projeto (/api/*)'],
  ];

  for (const [url, label] of blocked) {
    test(`bloqueia ${url.split('?')[0]}`, () => {
      const verdict = classifyResponsiveRequest(url);

      assert.equal(verdict.action, 'block');
      assert.equal(verdict.label, label);
    });
  }

  const allowed = [
    'http://127.0.0.1:3100/',
    'http://localhost:3100/js/app.js',
    'ws://127.0.0.1:3100/?token=abc',
    'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://fonts.googleapis.com/css2?family=Inter',
    'https://fonts.gstatic.com/s/inter/v13/x.woff2',
    'data:image/png;base64,AAAA',
  ];

  for (const url of allowed) {
    test(`permite ${url.slice(0, 60)}`, () => {
      assert.equal(classifyResponsiveRequest(url).action, 'allow');
    });
  }

  test('só o caminho /firebasejs/ do gstatic é permitido (não outros caminhos do host)', () => {
    assert.equal(
      classifyResponsiveRequest('https://www.gstatic.com/outra/coisa.js').action,
      'block'
    );
  });

  test('URL inválida falha fechado', () => {
    assert.equal(classifyResponsiveRequest('nao-e-url').action, 'block');
  });

  test('o registro da violação omite query e fragmento (chaves de API)', () => {
    const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=SEGREDO#x';
    const text = describeViolation('POST', url, classifyResponsiveRequest(url));

    assert.equal(
      text,
      'POST identitytoolkit.googleapis.com/v1/accounts:lookup [Firebase Auth remoto]'
    );
    assert.doesNotMatch(text, /SEGREDO/);
  });
});

describe('assertResponsiveLocalEnvironment', () => {
  test('ambiente vazio ou base URL local passa', () => {
    assert.deepEqual(assertResponsiveLocalEnvironment({}), { remotePreview: false });
    assert.deepEqual(
      assertResponsiveLocalEnvironment({ PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3100' }),
      {
        remotePreview: false,
      }
    );
    assert.deepEqual(
      assertResponsiveLocalEnvironment({ PLAYWRIGHT_BASE_URL: 'http://localhost:3100' }),
      {
        remotePreview: false,
      }
    );
  });

  test('credenciais reais reprovam', () => {
    assert.throws(
      () => assertResponsiveLocalEnvironment({ GOOGLE_APPLICATION_CREDENTIALS: 'x.json' }),
      /GOOGLE_APPLICATION_CREDENTIALS/
    );
    assert.throws(
      () => assertResponsiveLocalEnvironment({ FIREBASE_PRIVATE_KEY: 'x' }),
      /service account/
    );
    assert.throws(
      () => assertResponsiveLocalEnvironment({ FIREBASE_CLIENT_EMAIL: 'x' }),
      /service account/
    );
  });

  test('base URL remota reprova sem opt-in explícito', () => {
    assert.throws(
      () => assertResponsiveLocalEnvironment({ PLAYWRIGHT_BASE_URL: 'https://x.vercel.app' }),
      /remoto recusado/
    );
    assert.throws(
      () =>
        assertResponsiveLocalEnvironment({
          PLAYWRIGHT_BASE_URL: 'https://x.vercel.app',
          RESPONSIVE_ALLOW_REMOTE_PREVIEW: 'true',
        }),
      /remoto recusado/
    );
  });

  test('base URL inválida reprova', () => {
    assert.throws(
      () => assertResponsiveLocalEnvironment({ PLAYWRIGHT_BASE_URL: 'x' }),
      /não é uma URL válida/
    );
  });

  test('opt-in explícito (=1) habilita o modo remoto, que é sinalizado', () => {
    assert.deepEqual(
      assertResponsiveLocalEnvironment({
        PLAYWRIGHT_BASE_URL: 'https://x.vercel.app',
        RESPONSIVE_ALLOW_REMOTE_PREVIEW: '1',
      }),
      { remotePreview: true }
    );
  });

  test('credencial real reprova mesmo com opt-in remoto', () => {
    assert.throws(
      () =>
        assertResponsiveLocalEnvironment({
          PLAYWRIGHT_BASE_URL: 'https://x.vercel.app',
          RESPONSIVE_ALLOW_REMOTE_PREVIEW: '1',
          GOOGLE_APPLICATION_CREDENTIALS: 'x.json',
        }),
      /GOOGLE_APPLICATION_CREDENTIALS/
    );
  });
});
