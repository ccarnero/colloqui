import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const createAccount = async (db, data) => {
  try {
    const doc = {
      _id: new ObjectId(),
      waba_id: data.waba_id,
      phone_number_id: data.phone_number_id,
      display_phone: data.display_phone || null,
      access_token: data.access_token,
      token_expires_at: data.token_expires_at || null,
      business_name: data.business_name || null,
      meta_app_id: data.meta_app_id || null,
      meta_app_secret: data.meta_app_secret || null,
      status: 'active',
      owner_user_id: new ObjectId(data.owner_user_id),
      created_at: new Date(),
      updated_at: new Date(),
    }

    await db.collection('accounts').insertOne(doc)

    // Also add account to user's account_ids
    await db.collection('users').updateOne(
      { _id: doc.owner_user_id },
      { $addToSet: { account_ids: doc._id } }
    )

    return ok(doc)
  } catch (e) {
    return err(e.message)
  }
}

export { createAccount }
