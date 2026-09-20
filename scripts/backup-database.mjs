// Backup operacional canônico (schema v4) do Firestore.
// Executar: npm run backup
//
// Diferente da versão anterior, este script:
//  - FALHA (exit code != 0, sem gravar arquivo) se qualquer leitura falhar;
//  - gera o contrato v4 com hash (o mesmo formato do botão "Backup JSON" e aceito pelo restore);
//  - grava FORA do repositório (BACKUP_OUTPUT_DIR, senão Downloads, senão a pasta do usuário);
//  - não imprime dados pessoais (somente contagens, hash e nome do arquivo).
//
// Autenticação: conta de administrador ativo em FIREBASE_EMAIL / FIREBASE_PASSWORD (.env),
// pois `users` e `history` só podem ser lidos por administradores pelas regras do Firestore.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { COLLECTIONS, DB_BASE_PATH, FIREBASE_CONFIG } from '../src/js/config/constants.js';
import { buildBackupV4, normalizeBackup, verifyBackupDataHash } from '../src/js/utils/backupContract.js';

dotenv.config({ quiet: true });

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`ERRO: ${message}`);
  process.exit(1);
}

function isInsideRepository(directory) {
  const relative = path.relative(REPOSITORY_ROOT, directory);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveOutputDirectory() {
  const configured = process.env.BACKUP_OUTPUT_DIR?.trim();
  const downloads = path.join(os.homedir(), 'Downloads');
  const kind = configured ? 'BACKUP_OUTPUT_DIR' : fs.existsSync(downloads) ? 'Downloads' : 'home';
  const directory = path.resolve(configured || (kind === 'Downloads' ? downloads : os.homedir()));

  if (isInsideRepository(directory)) {
    fail('o diretório de saída está dentro do repositório. Defina BACKUP_OUTPUT_DIR fora dele.');
  }

  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    fail('o diretório de saída não existe.');
  }

  return { directory, kind };
}

async function readCollection(db, name) {
  try {
    const snapshot = await getDocs(collection(db, DB_BASE_PATH, name));

    return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  } catch (error) {
    return fail(`falha ao ler a collection "${name}" (${error?.code ?? 'erro desconhecido'}). Nenhum arquivo foi gerado.`);
  }
}

async function createBackup() {
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;

  if (!email || !password) {
    fail('configure FIREBASE_EMAIL e FIREBASE_PASSWORD no arquivo .env.');
  }

  const output = resolveOutputDirectory();
  const app = initializeApp(FIREBASE_CONFIG, 'backup-app');
  const db = getFirestore(app);

  try {
    await signInWithEmailAndPassword(getAuth(app), email, password);
  } catch (error) {
    fail(`falha na autenticação (${error?.code ?? 'erro desconhecido'}).`);
  }

  const parts = {};

  for (const name of [COLLECTIONS.TOOLS, COLLECTIONS.COLLABORATORS, COLLECTIONS.HISTORY, COLLECTIONS.USERS]) {
    parts[name] = await readCollection(db, name);
  }

  const backup = await buildBackupV4(parts, { generator: 'cli' });
  const hashCheck = await verifyBackupDataHash(backup);

  if (!hashCheck.ok) {
    fail('o hash do backup gerado não confere. Nenhum arquivo foi gerado.');
  }

  const validation = normalizeBackup(backup);

  const now = new Date().toISOString();
  const filename = `backup_gestao_ferramentas_v4_${now.slice(0, 10)}_${now.slice(11, 19).replace(/:/g, '')}.json`;

  fs.writeFileSync(path.join(output.directory, filename), JSON.stringify(backup, null, 2), {
    flag: 'wx',
    mode: 0o600
  });

  console.log(`Backup salvo: ${filename} (diretório: ${output.kind})`);
  console.log(
    `Registros: tools=${backup.summary.collections.tools} collaborators=${backup.summary.collections.collaborators} history=${backup.summary.collections.history} | referência de users=${backup.summary.usersReferenceCount}`
  );
  console.log(`Hash dos dados (SHA-256): ${backup.summary.dataSha256}`);

  if (!validation.ok) {
    console.warn(
      `AVISO: os dados atuais não passariam na validação de restauração (${validation.errorCount} problema(s)). O arquivo foi gerado mesmo assim.`
    );
  }

  process.exit(0);
}

createBackup();
