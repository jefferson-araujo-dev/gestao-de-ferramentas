// Versão mínima do app observável no servidor (Gate 1-F4.C4, Decisão 7, interpretação D4 = opção b).
//
// O cliente envia `X-App-Version` (src/js/modules/scanner.js). Este módulo apenas CLASSIFICA o valor
// e registra em log estruturado os clientes desatualizados, sem cabeçalho ou com cabeçalho inválido.
// Nunca rejeita a requisição, nunca altera status HTTP nem corpo de resposta: o objetivo é medir,
// antes do C8, se ainda há clientes antigos ativos (docs/design/USERS_AUDIT_SCREEN.md, seção E.4).
//
// Constante no código, não em variável de ambiente: a versão mínima acompanha o próprio deploy e
// fica auditável no Git. Valor inicial = versão de package.json do app que contém o C4. Clientes
// anteriores ao C4 não enviam o cabeçalho e são contados como "absent".
export const MIN_APP_VERSION = '3.1.0';

export const OUTDATED_CLIENT_EVENT = 'client_app_version_outdated';

const MAX_APP_VERSION_LENGTH = 32;
// MAJOR.MINOR.PATCH estritamente numérico; sufixos (pré-release, build) contam como inválidos.
const APP_VERSION_PATTERN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

export function parseAppVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = APP_VERSION_PATTERN.exec(value);

  return match ? match.slice(1).map(Number) : null;
}

// Negativo se a < b, zero se iguais, positivo se a > b. Recebe versões já validadas.
export function compareAppVersions(a, b) {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);

  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

// status: 'current' (igual ou acima da mínima), 'outdated', 'absent' ou 'invalid'.
// appVersion: o valor informado, aparado e truncado (nunca mais que MAX_APP_VERSION_LENGTH).
export function classifyClientVersion(header, minAppVersion = MIN_APP_VERSION) {
  const raw = Array.isArray(header) ? header[0] : header;

  if (typeof raw !== 'string' || !raw.trim()) {
    return { status: 'absent', appVersion: null };
  }

  const value = raw.trim();
  const appVersion = value.slice(0, MAX_APP_VERSION_LENGTH);

  if (value.length > MAX_APP_VERSION_LENGTH || !parseAppVersion(value)) {
    return { status: 'invalid', appVersion };
  }

  return {
    status: compareAppVersions(value, minAppVersion) < 0 ? 'outdated' : 'current',
    appVersion
  };
}

// Uma linha JSON só para cliente desatualizado/ausente/inválido. Só uid de autenticação, endpoint e
// versão: nenhum nome, e-mail ou dado de colaborador. Nunca lança: falha de log não pode afetar a
// requisição.
export function logOutdatedClientVersion(endpoint, uid, header, log = console.log) {
  try {
    const { status, appVersion } = classifyClientVersion(header);

    if (status === 'current') {
      return status;
    }

    log(
      JSON.stringify({
        event: OUTDATED_CLIENT_EVENT,
        endpoint,
        uid,
        reason: status,
        appVersion,
        minAppVersion: MIN_APP_VERSION
      })
    );

    return status;
  } catch {
    return 'error';
  }
}
