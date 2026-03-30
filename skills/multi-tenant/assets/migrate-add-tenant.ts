// Template: Migration Script
// Agrega campo tenant a documentos existentes

import { Db, MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
const DEFAULT_TENANT = process.env.TENANT || "acme";

async function main() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI environment variable is required");
    process.exit(1);
  }
  
  console.log(`Starting tenant migration with default tenant: ${DEFAULT_TENANT}`);
  
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    const collections = ["users", "accounts", "contacts", "messages"];
    let totalModified = 0;
    
    // 1. Agregar tenant a documentos que no lo tienen
    console.log("\n📦 Adding tenant field to documents...");
    for (const collection of collections) {
      const result = await db.collection(collection).updateMany(
        { tenant: { $exists: false } },
        { $set: { tenant: DEFAULT_TENANT } }
      );
      
      console.log(`  ${collection}: ${result.modifiedCount} documents updated`);
      totalModified += result.modifiedCount;
    }
    
    console.log(`\n✅ Total documents modified: ${totalModified}`);
    
    // 2. Verificar que no quedan documentos sin tenant
    console.log("\n🔍 Verifying all documents have tenant...");
    let hasErrors = false;
    
    for (const collection of collections) {
      const count = await db.collection(collection).countDocuments({
        tenant: { $exists: false }
      });
      
      if (count > 0) {
        console.error(`  ❌ ${collection}: ${count} documents still without tenant`);
        hasErrors = true;
      } else {
        const total = await db.collection(collection).countDocuments();
        console.log(`  ✓ ${collection}: ${total} documents (all have tenant)`);
      }
    }
    
    if (hasErrors) {
      console.error("\n❌ Migration failed: Some documents are missing tenant field");
      process.exit(1);
    }
    
    console.log("\n🎉 Migration completed successfully!");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Ejecutar si se corre directamente
if (import.meta.main) {
  main();
}

export { main as migrateAddTenant };
