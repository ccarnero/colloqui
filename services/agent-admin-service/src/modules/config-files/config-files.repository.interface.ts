export const CONFIG_FILES_REPOSITORY = Symbol("CONFIG_FILES_REPOSITORY");

export interface IConfigFile {
  id: string;
  name: string;
  path: string;
  content: string;
  format: "yaml" | "json";
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateConfigFileData {
  name: string;
  path: string;
  content: string;
  format: "yaml" | "json";
}

export interface IUpdateConfigFileData {
  name?: string;
  content?: string;
  is_active?: boolean;
}

export interface IFindAllConfigFilesOptions {
  limit?: number;
  offset?: number;
}

export interface IConfigFilesRepository {
  findAll(
    tenantId: string,
    options?: IFindAllConfigFilesOptions,
  ): Promise<{ files: IConfigFile[]; total: number }>;
  findByPath(tenantId: string, path: string): Promise<IConfigFile | null>;
  create(tenantId: string, data: ICreateConfigFileData): Promise<IConfigFile>;
  update(
    tenantId: string,
    path: string,
    data: IUpdateConfigFileData,
  ): Promise<IConfigFile | null>;
  findAllActive(tenantId: string): Promise<IConfigFile[]>;
}
