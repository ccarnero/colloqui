import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import type { IStringIdDoc } from "@yoizen/database";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type {
  IInsertRegisteredServiceOptions,
  IRegisteredServiceRow,
  IServicesRepository,
  IUpdateRegisteredServiceOptions,
} from "./services.repository.interface";

@Injectable()
export class ServicesMongoRepository implements IServicesRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  private collection() {
    return platformDb(this.client).collection<IStringIdDoc>("registered_services");
  }

  async findIdByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<IRegisteredServiceRow[]> {
    const doc = await this.collection().findOne(
      { tenant_id: tenantId, name },
      { projection: { _id: 1 } },
    );
    return doc ? [{ id: doc._id }] : [];
  }

  async insertRegisteredService(
    options: IInsertRegisteredServiceOptions,
  ): Promise<IRegisteredServiceRow[]> {
    const {
      id,
      tenantId,
      dto,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
      ksvcName,
      ns,
    } = options;
    const now = new Date();
    const doc = {
      _id: id,
      tenant_id: tenantId,
      name: dto.name,
      image: dto.image,
      port,
      min_scale: minScale,
      max_scale: maxScale,
      concurrency_target: concurrencyTarget,
      env_vars: envVars,
      status: "active",
      knative_name: ksvcName,
      namespace: ns,
      created_at: now,
      updated_at: now,
    };
    await this.collection().insertOne(doc);
    return [doc as IRegisteredServiceRow];
  }

  async listByTenant(tenantId: string): Promise<IRegisteredServiceRow[]> {
    const docs = await this.collection()
      .find({ tenant_id: tenantId })
      .sort({ created_at: -1 })
      .toArray();
    return docs as IRegisteredServiceRow[];
  }

  async findByIdAndTenant(
    id: string,
    tenantId: string,
  ): Promise<IRegisteredServiceRow[]> {
    const doc = await this.collection().findOne({
      _id: id,
      tenant_id: tenantId,
    });
    return doc ? [doc as IRegisteredServiceRow] : [];
  }

  async updateRegisteredService(
    options: IUpdateRegisteredServiceOptions,
  ): Promise<IRegisteredServiceRow[]> {
    const {
      id,
      tenantId,
      image,
      port,
      minScale,
      maxScale,
      concurrencyTarget,
      envVars,
    } = options;
    const result = await this.collection().findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      {
        $set: {
          image,
          port,
          min_scale: minScale,
          max_scale: maxScale,
          concurrency_target: concurrencyTarget,
          env_vars: envVars,
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? [result as IRegisteredServiceRow] : [];
  }

  async deleteById(id: string): Promise<void> {
    const db = platformDb(this.client);
    await Promise.all([
      db.collection<IStringIdDoc>("service_routes").deleteMany({ service_id: id }),
      db.collection<IStringIdDoc>("canary_deployments").deleteMany({ service_id: id }),
      db.collection<IStringIdDoc>("registered_services").deleteOne({ _id: id }),
    ]);
  }

  async selectKnativeMetaForRevision(
    id: string,
    tenantId: string,
  ): Promise<IRegisteredServiceRow[]> {
    const doc = await this.collection().findOne(
      { _id: id, tenant_id: tenantId },
      { projection: { knative_name: 1, namespace: 1 } },
    );
    return doc ? [doc as IRegisteredServiceRow] : [];
  }
}
