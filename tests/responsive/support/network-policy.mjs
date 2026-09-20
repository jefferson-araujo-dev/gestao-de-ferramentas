import { classifyRequestUrl } from '../../e2e/support/env.mjs';

// Política de rede FAIL-CLOSED da suíte responsiva. Reaproveita a allowlist do E2E autenticado
// (tests/e2e/support/env.mjs): só localhost e código/asset estático de CDN. Qualquer outro host é
// bloqueado e reprova o teste. Este módulo é puro (sem Playwright) para ser testado sem navegador.

const LOCAL_HOST_NAMES = ['127.0.0.1', 'localhost'];

// Só para rotular a mensagem de falha: hosts que são serviços reais do projeto/terceiros de dados.
// A decisão de bloquear NÃO depende desta lista (tudo fora da allowlist é bloqueado).
const REAL_SERVICE_PATTERNS = [
  [/(^|\.)firestore\.googleapis\.com$/, 'Firestore remoto'],
  [/(^|\.)(identitytoolkit|securetoken)\.googleapis\.com$/, 'Firebase Auth remoto'],
  [/(^|\.)cloudfunctions\.net$/, 'Firebase Functions real'],
  [/(^|\.)firebaseio\.com$/, 'Firebase Realtime Database'],
  [/(^|\.)(firebaseapp\.com|web\.app)$/, 'Firebase Hosting'],
  [/(^|\.)googleapis\.com$/, 'API Google'],
  [/(^|\.)(vercel\.app|vercel\.com|now\.sh)$/, 'Vercel real'],
];

function labelBlockedHost(host) {
  return (
    REAL_SERVICE_PATTERNS.find(([pattern]) => pattern.test(host))?.[1] ?? 'host fora da allowlist'
  );
}

// Retorna { action: 'allow' | 'block', kind, host, label? }. `label` só existe em bloqueios.
export function classifyResponsiveRequest(rawUrl) {
  const verdict = classifyRequestUrl(rawUrl);

  if (!verdict.allowed) {
    return {
      action: 'block',
      kind: verdict.kind,
      host: verdict.host,
      label: labelBlockedHost(verdict.host),
    };
  }

  if (verdict.kind === 'local' && new URL(rawUrl).pathname.startsWith('/api/')) {
    // Não existe função Vercel no servidor de desenvolvimento da suíte: nenhuma chamada /api/* é esperada.
    return {
      action: 'block',
      kind: 'local-api',
      host: verdict.host,
      label: 'API do projeto (/api/*)',
    };
  }

  return { action: 'allow', kind: verdict.kind, host: verdict.host };
}

// Texto seguro para log: método + host + caminho SEM query/fragmento (evita vazar chaves de API).
export function describeViolation(method, rawUrl, verdict) {
  let path = '';

  try {
    path = new URL(rawUrl).pathname;
  } catch {
    path = '';
  }

  return `${method} ${verdict.host || verdict.kind}${path} [${verdict.label}]`;
}

// Guard de ambiente da config responsiva: falha fechado antes de subir qualquer coisa.
export function assertResponsiveLocalEnvironment(env = process.env) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS definido: nenhuma credencial real pode existir na suíte responsiva.'
    );
  }

  if (env.FIREBASE_PRIVATE_KEY || env.FIREBASE_CLIENT_EMAIL) {
    throw new Error(
      'Variáveis de service account presentes: remova-as para rodar a suíte responsiva.'
    );
  }

  const externalBaseUrl = String(env.PLAYWRIGHT_BASE_URL || '').trim();

  if (!externalBaseUrl) {
    return { remotePreview: false };
  }

  let host;

  try {
    host = new URL(externalBaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('PLAYWRIGHT_BASE_URL não é uma URL válida.');
  }

  if (LOCAL_HOST_NAMES.includes(host)) {
    return { remotePreview: false };
  }

  if (env.RESPONSIVE_ALLOW_REMOTE_PREVIEW !== '1') {
    throw new Error(
      'PLAYWRIGHT_BASE_URL remoto recusado: a suíte responsiva só roda contra o servidor local. ' +
        'Testar um Vercel Preview exige opt-in explícito (RESPONSIVE_ALLOW_REMOTE_PREVIEW=1), ' +
        'fora do gate oficial, e nesse modo o guard de rede fica DESLIGADO.'
    );
  }

  return { remotePreview: true };
}
