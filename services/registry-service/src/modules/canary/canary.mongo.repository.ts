import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import type { IStringIdDoc } from "@yoizen/database";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type { UpdateCanaryDto } from "./canary.dto";
import type {
  ICanaryDbRow,
  ICanaryRepository,
  IInsertCanaryDeploymentOptions,
  IRegisteredServiceDbRow,
} from "./canary.repository.interface";

@Injectable()
export class CanaryMongoRepository implements ICanaryRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  private canaries() {
    return platformDb(this.client).collection<IStringIdDoc>("canary_deployments");
  }

  private services() {
    return platformDb(this.client).collection<IStringIdDoc>("registered_services");
  }

  async findProgressingCanary(serviceId: string) {
    const doc = await this.canaries().findOne(
      { service_id: serviceId, status: "progressing" },
      { projection: { _id: 1 } },
    );
    return doc ? [{ id: String(doc._id) }] : [];
  }

  async insertCanaryDeployment(
    options: IInsertCanaryDeploymentOptions,
  ): Promise<ICanaryDbRow[]> {
    const {
      id,
      serviceId,
      stableRevision,
      canaryRevision,
      percent,
    } = options;
    const now = new Date();
    const doc = {
      _id: id,
      service_id: serviceId,
      stable_revision: stableRevision,
      canary_revision: canaryRevision,
      canary_percent: percent,
      status: "progressing",
      created_at: now,
      updated_at: now,
    };
    await this.canaries().insertOne(doc);
    return [doc as ICanaryDbRow];
  }

  async updateCanaryPercent(
    canaryId: string,
    dto: UpdateCanaryDto,
  ): Promise<ICanaryDbRow[]> {
    const result = await this.canaries().findOneAndUpdate(
      { _id: canaryId },
      {
        $set: {
          canary_percent: dto.percent,
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? [result as ICanaryDbRow] : [];
  }

  async updateCanaryPromoted(canaryId: string): Promise<ICanaryDbRow[]> {
    const result = await this.canaries().findOneAndUpdate(
      { _id: canaryId },
      {
        $set: {
          canary_percent: 100,
          status: "promoted",
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? [result as ICanaryDbRow] : [];
  }

  async updateCanaryRolledBack(canaryId: string): Promise<ICanaryDbRow[]> {
    const result = await this.canaries().findOneAndUpdate(
      { _id: canaryId },
      {
        $set: {
          canary_percent: 0,
          status: "rolled_back",
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? [result as ICanaryDbRow] : [];
  }

  async getLatestCanaryForService(serviceId: string): Promise<ICanaryDbRow[]> {
    const doc = await this.canaries()
      .find({ service_id: serviceId })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    return doc ? [doc as ICanaryDbRow] : [];
  }

  async findRegisteredService(
    serviceId: string,
    tenantId: string,
  ): Promise<IRegisteredServiceDbRow[]> {
    const doc = await this.services().findOne({
      _id: serviceId,
      tenant_id: tenantId,
    });
    return doc ? [doc as IRegisteredServiceDbRow] : [];
  }

  async findActiveCanary(serviceId: string): Promise<ICanaryDbRow[]> {
    const doc = await this.canaries()
      .find({ service_id: serviceId, status: "progressing" })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    return doc ? [doc as ICanaryDbRow] : [];
  }
}
