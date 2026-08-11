// Script para ler dados do Firebase e gerar populate.html atualizado
import dotenv from "dotenv";
dotenv.config();
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import fs from "fs";
import { FIREBASE_CONFIG, DB_BASE_PATH, COLLECTIONS } from "../src/js/config/constants.js";

async function exportFirebaseData() {
  console.log("📊 Lendo dados do Firebase...\n");

  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);

  // Login
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;

  if (!email || !password) {
    console.log("❌ Configure FIREBASE_EMAIL e FIREBASE_PASSWORD no .env");
    process.exit(1);
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    console.log("✅ Autenticado no Firebase\n");
  } catch (err) {
    console.log("❌ Erro de autenticação:", err.message);
    process.exit(1);
  }

  const collections = Object.values(COLLECTIONS);
  const data = {};

  for (const colName of collections) {
    try {
      const colRef = collection(db, DB_BASE_PATH, colName);
      const snapshot = await getDocs(colRef);

      const docs = [];
      snapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
      });

      data[colName] = docs;
      console.log(`✅ ${colName}: ${docs.length} documentos`);
    } catch (err) {
      console.log(`⚠️  ${colName}: Erro ao ler (${err.message})`);
      data[colName] = [];
    }
  }

  // Salvar em JSON
  const jsonPath = "firebase-data-export.json";
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`\n📁 Dados salvos em: ${jsonPath}`);

  // Mostrar resumo
  console.log("\n📋 Resumo dos dados:");
  for (const [col, docs] of Object.entries(data)) {
    console.log(`   • ${col}: ${docs.length} docs`);
    if (docs.length > 0) {
      const sample = docs[0];
      const fields = Object.keys(sample)
        .filter((k) => k !== "id")
        .slice(0, 3);
      console.log(`     Campos: ${fields.join(", ")}...`);
    }
  }

  process.exit(0);
}

exportFirebaseData();
