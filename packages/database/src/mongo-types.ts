import type { Document } from "mongodb";

/**
 * Document type with a string `_id`. The project uses application-generated
 * UUIDs and request IDs as primary keys (not Mongo `ObjectId`), so all
 * repositories that store these must type their collection access with
 * `db.collection<IStringIdDoc>("...")` to override the driver's default
 * `_id: ObjectId` typing.
 */
export type IStringIdDoc<T extends Document = Document> = T & { _id: string };
