import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Document, WithId } from "mongodb";
import type { IStringIdDoc, TenantMongoConnectionManager } from "@yoizen/database";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IConfigFile,
  IConfigFilesRepository,
  ICreateConfigFileData,
  IFindAllConfigFilesOptions,
  IUpdateConfigFileData,
} from "./config-files.repository.interface";

function docToConfigFile(doc: WithId<IStringIdDoc>): IConfigFile {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    path: String(doc.path ?? ""),
    content: String(doc.content ?? ""),
    format: String(doc.format ?? "yaml") as IConfigFile["format"],
    version: Number(doc.version ?? 1),
    is_active: Boolean(doc.is_active ?? true),
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updated_at:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
  };
}

@Injectable()
export class ConfigFilesMongoRepository extends TenantScopedMongoRepository implements IConfigFilesRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IFindAllConfigFilesOptions = {},
  ): Promise<{ files: IConfigFile[]; total: number }> {
    const db = await this.getDb(tenantId);
    const col = db.collection<IStringIdDoc>("config_files");
    const { limit = 20, offset = 0 } = options;
    const filter = { is_active: true };
    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return { files: docs.map(docToConfigFile), total };
  }

  async findByPath(tenantId: string, path: string): Promise<IConfigFile | null> {
    const db = await this.getDb(tenantId);
    const doc = await db.collection<IStringIdDoc>("config_files").findOne({
      path,
      is_active: true,
    });
    return doc ? docToConfigFile(doc) : null;
  }

  async create(
    tenantId: string,
    data: ICreateConfigFileData,
  ): Promise<IConfigFile> {
    const db = await this.getDb(tenantId);
    const now = new Date();
    const doc = {
      _id: randomUUID(),
      name: data.name,
      path: data.path,
      content: data.content,
      format: data.format,
      version: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    };
    await db.collection<IStringIdDoc>("config_files").insertOne(doc);
    return docToConfigFile(doc as WithId<IStringIdDoc>);
  }

  async update(
    tenantId: string,
    path: string,
    data: IUpdateConfigFileData,
  ): Promise<IConfigFile | null> {
    const db = await this.getDb(tenantId);
    const setFields: Document = { updated_at: new Date() };
    if (data.name !== undefined) setFields.name = data.name;
    if (data.content !== undefined) setFields.content = data.content;
    if (data.is_active !== undefined) setFields.is_active = data.is_active;

    const result = await db.collection<IStringIdDoc>("config_files").findOneAndUpdate(
      { path, is_active: true },
      [
        {
          $set: {
            ...setFields,
            version: { $add: ["$version", 1] },
          },
        },
      ],
      { returnDocument: "after" },
    );
    return result ? docToConfigFile(result) : null;
  }

  async findAllActive(tenantId: string): Promise<IConfigFile[]> {
    const db = await this.getDb(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("config_files")
      .find({ is_active: true })
      .sort({ path: 1 })
      .toArray();
    return docs.map(docToConfigFile);
  }
}
