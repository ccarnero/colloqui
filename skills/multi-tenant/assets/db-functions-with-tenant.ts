// Template: Database Functions with Tenant
// Funciones de DB que filtran por tenant

import { Db, ObjectId } from "mongodb";
import { ok, err, type Result } from "../../lib/result.js";

// ============================================================================
// USERS
// ============================================================================

export interface User {
  _id: ObjectId;
  tenant: string;
  email: string;
  password_hash: string;
  name: string;
  role: "admin" | "operator";
  account_ids: ObjectId[];
  created_at: Date;
}

export interface CreateUserData {
  email: string;
  password_hash: string;
  name: string;
  role?: "admin" | "operator";
}

/**
 * Busca un usuario por email dentro de un tenant
 */
export async function findUserByEmail(
  db: Db,
  tenant: string,
  email: string
): Promise<Result<User | null, string>> {
  try {
    // SIEMPRE filtrar por tenant primero
    const user = await db.collection<User>("users").findOne({
      tenant,
      email: email.toLowerCase()
    });
    return ok(user);
  } catch (error) {
    return err(`find_user_failed: ${error}`);
  }
}

/**
 * Crea un usuario en un tenant específico
 */
export async function createUser(
  db: Db,
  tenant: string,
  data: CreateUserData
): Promise<Result<User, string>> {
  try {
    const user: Omit<User, "_id"> = {
      tenant, // ← campo obligatorio
      email: data.email.toLowerCase(),
      password_hash: data.password_hash,
      name: data.name,
      role: data.role || "operator",
      account_ids: [],
      created_at: new Date()
    };
    
    const result = await db.collection("users").insertOne(user);
    return ok({ ...user, _id: result.insertedId });
  } catch (error) {
    if (error.code === 11000) {
      return err("user_already_exists");
    }
    return err(`create_user_failed: ${error}`);
  }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export interface Account {
  _id: ObjectId;
  tenant: string;
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  access_token: string;
  token_expires_at?: Date;
  business_name: string;
  meta_app_id?: string;
  meta_app_secret?: string;
  status: string;
  owner_user_id: ObjectId;
  created_at: Date;
  updated_at: Date;
}

/**
 * Busca account por phone_number_id (para webhooks)
 */
export async function findAccountByPhone(
  db: Db,
  tenant: string,
  phoneNumberId: string
): Promise<Result<Account | null, string>> {
  try {
    // SIEMPRE filtrar por tenant
    const account = await db.collection<Account>("accounts").findOne({
      tenant,
      phone_number_id: phoneNumberId
    });
    return ok(account);
  } catch (error) {
    return err(`find_account_failed: ${error}`);
  }
}

/**
 * Lista accounts de un tenant
 */
export async function listAccounts(
  db: Db,
  tenant: string,
  ownerUserId?: ObjectId
): Promise<Result<Account[], string>> {
  try {
    const filter: Record<string, unknown> = { tenant };
    
    if (ownerUserId) {
      filter.owner_user_id = ownerUserId;
    }
    
    const accounts = await db
      .collection<Account>("accounts")
      .find(filter)
      .toArray();
    
    return ok(accounts);
  } catch (error) {
    return err(`list_accounts_failed: ${error}`);
  }
}

// ============================================================================
// MESSAGES
// ============================================================================

export interface Message {
  _id: ObjectId;
  tenant: string;
  account_id: ObjectId;
  contact_id: ObjectId;
  wa_message_id: string;
  wa_sender_id: string;
  direction: "inbound" | "outbound";
  source: "human" | "bot" | "template";
  type: string;
  content: unknown;
  status: string;
  timestamp: Date;
  created_at: Date;
}

/**
 * Guarda un mensaje con tenant
 */
export async function saveMessage(
  db: Db,
  tenant: string,
  data: Omit<Message, "_id" | "tenant" | "created_at">
): Promise<Result<Message, string>> {
  try {
    const message: Omit<Message, "_id"> = {
      tenant, // ← campo obligatorio
      ...data,
      created_at: new Date()
    };
    
    const result = await db.collection("messages").insertOne(message);
    return ok({ ...message, _id: result.insertedId });
  } catch (error) {
    return err(`save_message_failed: ${error}`);
  }
}

/**
 * Lista mensajes de una conversación (tenant + account + contact)
 */
export async function listMessagesByConversation(
  db: Db,
  tenant: string,
  accountId: ObjectId,
  contactId: ObjectId,
  options: { limit?: number; before?: Date } = {}
): Promise<Result<Message[], string>> {
  try {
    const filter = {
      tenant,
      account_id: accountId,
      contact_id: contactId
    };
    
    if (options.before) {
      (filter as Record<string, unknown>).created_at = { $lt: options.before };
    }
    
    const messages = await db
      .collection<Message>("messages")
      .find(filter)
      .sort({ created_at: -1 })
      .limit(options.limit || 50)
      .toArray();
    
    return ok(messages);
  } catch (error) {
    return err(`list_messages_failed: ${error}`);
  }
}
