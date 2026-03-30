export interface IRegisteredService {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly image: string;
  readonly port: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly concurrencyTarget: number;
  readonly envVars: Record<string, string>;
  readonly status: string;
  readonly knativeName: string | null;
  readonly namespace: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IServiceDetail extends IRegisteredService {
  readonly knativeStatus?: Record<string, unknown>;
}

export interface ICreateService {
  readonly name: string;
  readonly image: string;
  readonly port?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly concurrencyTarget?: number;
  readonly envVars?: Record<string, string>;
}

export interface IUpdateService {
  readonly image?: string;
  readonly port?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly concurrencyTarget?: number;
  readonly envVars?: Record<string, string>;
}

export interface IServiceRoute {
  readonly id: string;
  readonly serviceId: string;
  readonly pathPrefix: string;
  readonly methods: string[];
  readonly isPublic: boolean;
  readonly stripPrefix: boolean;
  readonly createdAt: string;
}

export interface ICreateRoute {
  readonly pathPrefix: string;
  readonly methods?: string[];
  readonly isPublic?: boolean;
  readonly stripPrefix?: boolean;
}
