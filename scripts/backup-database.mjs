// Script para backup completo do Firebase Firestore para JSON
// Executar: npm run backup

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  FIREBASE_CONFIG,
  DB_BASE_PATH,
  COLLECTIONS,
} from "../src/js/config/constants.js";

dotenv.config();

async function createBackup() {
  console.log("\n🚀 Iniciando Backup do Sistema...\n");

  const app = initializeApp(FIREBASE_CONFIG, "backup-app");
  const db = getFirestore(app);
  const auth = getAuth(app);

  // Autenticação necessária para ler os dados
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;

  if (!email || !password) {
    console.log(
      "❌ Configure FIREBASE_EMAIL e FIREBASE_PASSWORD no arquivo .env",
    );
    process.exit(1);
  }

  try {
    console.log("🔐 Autenticando no Firebase...");
    await signInWithEmailAndPassword(auth, email, password);
    console.log("✅ Autenticado com sucesso!\n");
  } catch (err) {
    console.log("❌ Erro na autenticação:", err.message);
    process.exit(1);
  }

  const backupData = {};
  let totalDocs = 0;

  for (const colName of Object.values(COLLECTIONS)) {
    console.log(`📥 Lendo collection: ${colName}...`);
    try {
      // Usa o caminho aninhado
      const colRef = collection(db, DB_BASE_PATH, colName);
      const snapshot = await getDocs(colRef);

      const docs = [];
      snapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
      });

      backupData[colName] = docs;
      totalDocs += docs.length;
      console.log(`   ✅ ${colName}: ${docs.length} documentos\n`);
    } catch (err) {
      console.log(`   ⚠️ Erro ao ler ${colName}: ${err.message}\n`);
      backupData[colName] = [];
    }
  }

  // Gerar arquivo com timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}.json`;

  fs.writeFileSync(filename, JSON.stringify(backupData, null, 2));
  console.log(`💾 Backup salvo em: ${path.resolve(filename)}`);
  console.log(`📊 Total de documentos exportados: ${totalDocs}`);
  console.log("✅ Backup concluído!\n");

  process.exit(0);
}

createBackup();
