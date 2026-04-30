// Template: MongoDB Indexes for Multi-Tenant
// Índices compound con tenant como primer campo

import { Db } from "mongodb";

/**
 * Crea todos los índices necesarios para multi-tenancy
 * Esta función debe llamarse al conectar a la DB
 */
export async function ensureTenantIndexes(db: Db): Promise<void> {
  // ============================================================================
  // USERS
  // ============================================================================
  
  // Eliminar índice viejo si existe
  await db.collection("users").dropIndex("email_1").catch(() => {});
  
  // Nuevo índice compound: tenant + email (único)
  await db.collection("users").createIndex(
    { tenant: 1, email: 1 },
    { 
      unique: true, 
      name: "tenant_email_unique",
      background: true 
    }
  );
  
  console.log("✓ users: tenant_email_unique");
  
  // ============================================================================
  // ACCOUNTS
  // ============================================================================
  
  // Eliminar índices viejos
  await db.collection("accounts").dropIndex("owner_user_id_1").catch(() => {});
  await db.collection("accounts").dropIndex("waba_id_1").catch(() => {});
  await db.collection("accounts").dropIndex("phone_number_id_1").catch(() => {});
  
  // tenant + phone_number_id (único, para lookup de webhooks)
  await db.collection("accounts").createIndex(
    { tenant: 1, phone_number_id: 1 },
    { 
      unique: true, 
      name: "tenant_phone_unique",
      background: true
    }
  );
  
  // tenant + owner (para listar accounts de un usuario)
  await db.collection("accounts").createIndex(
    { tenant: 1, owner_user_id: 1 },
    { name: "tenant_owner", background: true }
  );
  
  // tenant + waba_id (para lookups por WABA)
  await db.collection("accounts").createIndex(
    { tenant: 1, waba_id: 1 },
    { name: "tenant_waba", background: true }
  );
  
  console.log("✓ accounts: tenant_phone_unique, tenant_owner, tenant_waba");
  
  // ============================================================================
  // CONTACTS
  // ============================================================================
  
  // Eliminar índices viejos
  await db.collection("contacts").dropIndex("account_id_1_wa_id_1").catch(() => {});
  
  // tenant + account + wa_id (único)
  await db.collection("contacts").createIndex(
    { tenant: 1, account_id: 1, wa_id: 1 },
    { 
      unique: true, 
      name: "tenant_account_waid_unique",
      background: true
    }
  );
  
  // tenant + account + phone (sparse - solo contactos con phone)
  await db.collection("contacts").createIndex(
    { tenant: 1, account_id: 1, phone: 1 },
    { 
      name: "tenant_account_phone",
      sparse: true,
      background: true
    }
  );
  
  // tenant + account + bsuid (sparse - solo contactos con BSUID)
  await db.collection("contacts").createIndex(
    { tenant: 1, account_id: 1, bsuid: 1 },
    { 
      name: "tenant_account_bsuid",
      sparse: true,
      background: true
    }
  );
  
  console.log("✓ contacts: tenant_account_waid_unique, tenant_account_phone, tenant_account_bsuid");
  
  // ============================================================================
  // MESSAGES
  // ============================================================================
  
  // Eliminar índice viejo
  await db.collection("messages")
    .dropIndex("account_id_1_contact_id_1_created_at_-1")
    .catch(() => {});
  
  // tenant + account + contact + fecha (para listar conversaciones)
  await db.collection("messages").createIndex(
    { tenant: 1, account_id: 1, contact_id: 1, created_at: -1 },
    { name: "tenant_account_contact_date", background: true }
  );
  
  // tenant + wa_message_id (para lookups por WA message ID)
  await db.collection("messages").createIndex(
    { tenant: 1, wa_message_id: 1 },
    { name: "tenant_wa_msg_id", sparse: true, background: true }
  );
  
  console.log("✓ messages: tenant_account_contact_date, tenant_wa_msg_id");
  
  console.log("\n✅ All tenant indexes created successfully");
}

/**
 * Valida que todos los documentos tienen campo tenant
 */
export async function validateAllDocsHaveTenant(db: Db): Promise<boolean> {
  const collections = ["users", "accounts", "contacts", "messages"];
  let allValid = true;
  
  for (const collection of collections) {
    const withoutTenant = await db
      .collection(collection)
      .countDocuments({ tenant: { $exists: false } });
    
    const total = await db.collection(collection).countDocuments();
    
    if (withoutTenant > 0) {
      console.error(`❌ ${collection}: ${withoutTenant}/${total} docs without tenant`);
      allValid = false;
    } else {
      console.log(`✓ ${collection}: ${total} docs, all have tenant`);
    }
  }
  
  return allValid;
}
