import {
  getHttpStatus,
  requireActiveUser
} from '../../server/admin-authorization.js';

const MAX_DEVICE_LENGTH = 160;
const MAX_IP_LENGTH = 128;
const UNKNOWN_IP = 'IP Desconhecido';

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseDevice(req) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Descrição do dispositivo inválida.');
  }

  const keys = Object.keys(body);

  if (keys.length !== 1 || keys[0] !== 'device' || typeof body.device !== 'string') {
    throw createHttpError(400, 'Descrição do dispositivo inválida.');
  }

  const device = body.device.trim();

  if (!device || device.length > MAX_DEVICE_LENGTH) {
    throw createHttpError(400, 'Descrição do dispositivo inválida.');
  }

  return device;
}

function removeControlCharacters(value) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
}

function normalizeIp(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const firstValue = removeControlCharacters(value).split(',')[0].trim();
  const withoutIpv4MappedPrefix = firstValue.startsWith('::ffff:')
    ? firstValue.slice('::ffff:'.length)
    : firstValue;

  return withoutIpv4MappedPrefix.trim().slice(0, MAX_IP_LENGTH);
}

function getHeaderIp(req, headerName) {
  const headerValue = req.headers?.[headerName];
  const values = Array.isArray(headerValue) ? headerValue : [headerValue];

  for (const value of values) {
    const ip = normalizeIp(value);

    if (ip) {
      return ip;
    }
  }

  return '';
}

function getRequestIp(req) {
  const headerNames = [
    'x-vercel-forwarded-for',
    'x-forwarded-for',
    'x-real-ip'
  ];

  for (const headerName of headerNames) {
    const ip = getHeaderIp(req, headerName);

    if (ip) {
      return ip;
    }
  }

  const socketAddresses = [
    req.socket?.remoteAddress,
    req.connection?.remoteAddress
  ];

  for (const address of socketAddresses) {
    const ip = normalizeIp(address);

    if (ip) {
      return ip;
    }
  }

  return UNKNOWN_IP;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      message: 'Método não permitido.'
    });
  }

  try {
    const authorization = await requireActiveUser(req);
    const device = parseDevice(req);
    const lastLogin = new Date().toISOString();
    const lastIp = getRequestIp(req);

    await authorization.profileRef.update({
      lastLogin,
      lastIp,
      lastDevice: device
    });

    return res.status(200).json({
      success: true,
      message: 'Último login atualizado.'
    });
  } catch (error) {
    const statusCode = getHttpStatus(error);

    if (statusCode >= 500) {
      console.error('Erro ao atualizar o último login:', error);

      return res.status(500).json({
        success: false,
        message: 'Erro interno ao atualizar o último login.'
      });
    }

    return res.status(statusCode).json({
      success: false,
      message: error.message
    });
  }
}
