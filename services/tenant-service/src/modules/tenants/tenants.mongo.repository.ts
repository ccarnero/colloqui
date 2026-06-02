import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "mongodb";
import {
  isTenantDatabaseTier,
  isProvisioningStatus,
  ProvisioningStatus,
  TenantDatabaseTier,
  type ProvisioningStatusValue,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";
import { MONGO_CLIENT } from "../../providers/platform-mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type { ITenantRow, TenantConfiguration } from "./tenant.dto";
import type { ITenantsRepository } from "./tenants.repository.interface";

interface ITenantDoc {
  readonly _id: string;
  readonly name: string;
  readonly tier: TenantDatabaseTierValue;
  readonly configuration: TenantConfiguration;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly provisioning_status: ProvisioningStatusValue;
  readonly provisioning_error: string | null;
  readonly provisioning_started_at: Date | null;
  readonly provisioning_completed_at: Date | null;
}

function mapRow(doc: ITenantDoc): ITenantRow {
  const raw = doc.provisioning_status;
  const rawTier = doc.tier;
  const ps: ProvisioningStatusValue =
    raw === undefined || raw === null
      ? ProvisioningStatus.Ready
      : isProvisioningStatus(raw)
        ? raw
        : (() => {
            throw new Error(
              `Invalid provisioning_status in DB: ${String(raw)}`,
            );
          })();
  const tier: TenantDatabaseTierValue =
    rawTier === undefined || rawTier === null
      ? TenantDatabaseTier.Shared
      : isTenantDatabaseTier(rawTier)
        ? rawTier
        : (() => {
            throw new Error(`Invalid tenant tier in DB: ${String(rawTier)}`);
          })();
  return {
    id: doc._id,
    name: doc.name,
    tier,
    configuration: doc.configuration ?? {},
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    provisioning_status: ps,
    provisioning_error: doc.provisioning_error ?? null,
    provisioning_started_at: doc.provisioning_started_at ?? null,
    provisioning_completed_at: doc.provisioning_completed_at ?? null,
  };
}

@Injectable()
export class TenantsMongoRepository implements ITenantsRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  private collection() {
    return platformDb(this.client).collection<ITenantDoc>("tenants");
  }

  async create(
    id: string,
    name: string,
    tier: TenantDatabaseTierValue = TenantDatabaseTier.Shared,
    configuration: TenantConfiguration = {},
  ): Promise<ITenantRow> {
    const now = new Date();
    const doc: ITenantDoc = {
      _id: id,
      name,
      tier,
      configuration,
      created_at: now,
      updated_at: now,
      provisioning_status: ProvisioningStatus.Pending,
      provisioning_error: null,
      provisioning_started_at: null,
      provisioning_completed_at: null,
    };
    await this.collection().insertOne(doc);
    return mapRow(doc);
  }

  async findById(id: string): Promise<ITenantRow | undefined> {
    const doc = await this.collection().findOne({ _id: id });
    return doc ? mapRow(doc) : undefined;
  }

  async findByName(name: string): Promise<ITenantRow | undefined> {
    const doc = await this.collection().findOne({ name });
    return doc ? mapRow(doc) : undefined;
  }

  async findAll(filter?: {
    status?: ProvisioningStatusValue;
  }): Promise<ITenantRow[]> {
    const query =
      filter?.status === undefined
        ? {}
        : { provisioning_status: filter.status };
    const docs = await this.collection()
      .find(query)
      .sort({ created_at: 1 })
      .toArray();
    const out: ITenantRow[] = new Array(docs.length);
    for (let i = 0; i < docs.length; i++) {
      out[i] = mapRow(docs[i]!);
    }
    return out;
  }

  async markProvisioningStarted(id: string): Promise<void> {
    const existing = await this.collection().findOne(
      { _id: id },
      { projection: { provisioning_started_at: 1 } },
    );
    const now = new Date();
    await this.collection().updateOne(
      { _id: id },
      {
        $set: {
          provisioning_status: ProvisioningStatus.Provisioning,
          provisioning_error: null,
          updated_at: now,
          ...(existing?.provisioning_started_at === null ||
          existing?.provisioning_started_at === undefined
            ? { provisioning_started_at: now }
            : {}),
        },
      },
    );
  }

  async markProvisioningReady(id: string): Promise<void> {
    const now = new Date();
    await this.collection().updateOne(
      { _id: id },
      {
        $set: {
          provisioning_status: ProvisioningStatus.Ready,
          provisioning_error: null,
          provisioning_completed_at: now,
          updated_at: now,
        },
      },
    );
  }

  async markProvisioningFailed(id: string, err: string): Promise<void> {
    const now = new Date();
    await this.collection().updateOne(
      { _id: id },
      {
        $set: {
          provisioning_status: ProvisioningStatus.Failed,
          provisioning_error: err,
          provisioning_completed_at: now,
          updated_at: now,
        },
      },
    );
  }

  async setProvisioningStatus(
    id: string,
    status: ProvisioningStatusValue,
    error: string | null,
  ): Promise<void> {
    await this.collection().updateOne(
      { _id: id },
      {
        $set: {
          provisioning_status: status,
          provisioning_error: error,
          updated_at: new Date(),
        },
      },
    );
  }

  async updateConfiguration(
    name: string,
    configuration: TenantConfiguration,
  ): Promise<ITenantRow | undefined> {
    const doc = await this.collection().findOneAndUpdate(
      { name },
      {
        $set: {
          configuration,
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return doc ? mapRow(doc) : undefined;
  }

  async deleteByName(name: string): Promise<boolean> {
    const result = await this.collection().deleteOne({ name });
    return result.deletedCount > 0;
  }
}
