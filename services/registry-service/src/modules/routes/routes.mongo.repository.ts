import { Inject, Injectable } from "@nestjs/common";
import type { MongoClient } from "@yoizen/database";
import type { IStringIdDoc } from "@yoizen/database";
import { MONGO_CLIENT } from "../../providers/mongo.provider";
import { platformDb } from "../../providers/platform-db";
import type {
  IInsertRouteOptions,
  IRouteDiscoverySqlRow,
  IRouteRow,
  IRoutesRepository,
} from "./routes.repository.interface";

@Injectable()
export class RoutesMongoRepository implements IRoutesRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  private routes() {
    return platformDb(this.client).collection<IStringIdDoc>("service_routes");
  }

  private services() {
    return platformDb(this.client).collection<IStringIdDoc>("registered_services");
  }

  async findServiceByTenant(
    serviceId: string,
    tenantId: string,
  ): Promise<IRouteRow[]> {
    const doc = await this.services().findOne(
      { _id: serviceId, tenant_id: tenantId },
      { projection: { _id: 1 } },
    );
    return doc ? [{ id: doc._id }] : [];
  }

  async insertRoute(options: IInsertRouteOptions): Promise<IRouteRow[]> {
    const { id, serviceId, dto, methods, isPublic, stripPrefix } = options;
    const doc = {
      _id: id,
      service_id: serviceId,
      path_prefix: dto.pathPrefix,
      methods,
      is_public: isPublic,
      strip_prefix: stripPrefix,
      created_at: new Date(),
    };
    await this.routes().insertOne(doc);
    return [doc as IRouteRow];
  }

  async listRoutesForService(serviceId: string): Promise<IRouteRow[]> {
    const docs = await this.routes()
      .find({ service_id: serviceId })
      .sort({ created_at: 1 })
      .toArray();
    return docs as IRouteRow[];
  }

  async deleteRoute(
    routeId: string,
    serviceId: string,
  ): Promise<{ count: number }> {
    const result = await this.routes().deleteOne({
      _id: routeId,
      service_id: serviceId,
    });
    return { count: result.deletedCount };
  }

  async discoverActiveRoutes(): Promise<IRouteDiscoverySqlRow[]> {
    const rows = await this.routes()
      .aggregate([
        {
          $lookup: {
            from: "registered_services",
            localField: "service_id",
            foreignField: "_id",
            as: "svc",
          },
        },
        { $unwind: "$svc" },
        { $match: { "svc.status": "active" } },
        {
          $project: {
            id: "$_id",
            tenant_id: "$svc.tenant_id",
            service_name: "$svc.name",
            knative_name: "$svc.knative_name",
            namespace: "$svc.namespace",
            port: "$svc.port",
            path_prefix: 1,
            methods: 1,
            is_public: 1,
            strip_prefix: 1,
          },
        },
        { $sort: { tenant_id: 1, path_prefix: 1 } },
      ])
      .toArray();
    return rows as IRouteDiscoverySqlRow[];
  }
}
