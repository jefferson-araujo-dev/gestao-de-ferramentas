// Guards de ambiente do E2E autenticado: a suíte só roda contra o Firebase Emulator local.
// Falha fechado: qualquer dúvida sobre o ambiente aborta antes de qualquer teste ou request.

export const PROJECT_ID = 'gestao-de-ferramentas-3f8f1';
export const DB_BASE_PATH = `artifacts/${PROJECT_ID}/public/data`;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

function parseLocalHost(env, name) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} ausente: o E2E autenticado só roda dentro do Firebase Emulator (npm run test:e2e:auth).`
    );
  }

  const match = /^([^:/\s]+):(\d{2,5})$/.exec(value);

  if (!match || !LOCAL_HOSTS.includes(match[1].toLowerCase())) {
    throw new Error(`${name} deve apontar somente para 127.0.0.1 ou localhost.`);
  }

  return { host: match[1], port: Number(match[2]) };
}

export function assertEmulatorOnlyEnvironment(env = process.env) {
  const firestore = parseLocalHost(env, 'FIRESTORE_EMULATOR_HOST');
  const auth = parseLocalHost(env, 'FIREBASE_AUTH_EMULATOR_HOST');

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS definido: nenhuma credencial real pode existir neste E2E.'
    );
  }

  if (env.PLAYWRIGHT_BASE_URL?.trim()) {
    throw new Error('PLAYWRIGHT_BASE_URL não é permitido: o E2E sobe o próprio servidor local.');
  }

  if (env.FIREBASE_PRIVATE_KEY || env.FIREBASE_CLIENT_EMAIL) {
    throw new Error('Variáveis de service account presentes: remova-as para rodar o E2E.');
  }

  return { firestore, auth };
}

// Único conjunto de hosts que o navegador pode contatar durante os testes.
// Os CDNs servem apenas código estático (SDK, bibliotecas); dados e autenticação só vão ao emulator.
export function classifyRequestUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, kind: 'invalid', host: '' };
  }

  if (['data:', 'blob:', 'about:'].includes(url.protocol)) {
    return { allowed: true, kind: 'inline', host: '' };
  }

  const host = url.hostname.toLowerCase();

  if (LOCAL_HOSTS.includes(host)) {
    return { allowed: true, kind: 'local', host };
  }

  if (host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    return { allowed: true, kind: 'cdn-firebase-sdk', host };
  }

  if (host === 'cdn.jsdelivr.net' || host === 'cdnjs.cloudflare.com') {
    return { allowed: true, kind: 'cdn-static', host };
  }

  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    return { allowed: true, kind: 'fonts-stubbed', host };
  }

  // Achado pré-existente: a tela de login carrega uma imagem decorativa de terceiro.
  // O E2E não contata esse host: a resposta é substituída por um PNG local mínimo.
  if (host === 'images.unsplash.com') {
    return { allowed: true, kind: 'third-party-image-stubbed', host };
  }

  return { allowed: false, kind: 'blocked', host };
}
