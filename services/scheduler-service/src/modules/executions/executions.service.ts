import { Injectable } from "@nestjs/common";
import {
  ExecutionsRepository,
  type IExecutionLog,
  type IUpdateExecutionStatusOptions,
} from "./executions.repository";
import type { IExecutionQueryParams } from "../../types";

@Injectable()
export class ExecutionsService {
  constructor(private readonly executionsRepository: ExecutionsRepository) {}

  async createLog(
    scheduleId: string,
    tenantId: string,
  ): Promise<IExecutionLog> {
    return this.executionsRepository.createLog(scheduleId, tenantId);
  }

  async updateStatus(
    opts: IUpdateExecutionStatusOptions,
  ): Promise<IExecutionLog> {
    return this.executionsRepository.updateStatus(opts);
  }

  async findByScheduleId(
    scheduleId: string,
    params: IExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: IExecutionLog[]; limit: number; offset: number }> {
    return this.executionsRepository.findByScheduleId(
      scheduleId,
      params,
      tenantId,
    );
  }

  async findAll(
    params: IExecutionQueryParams,
    tenantId: string,
  ): Promise<{ executions: IExecutionLog[]; limit: number; offset: number }> {
    return this.executionsRepository.findAll(params, tenantId);
  }

  async findById(id: string, tenantId: string): Promise<IExecutionLog | null> {
    return this.executionsRepository.findById(id, tenantId);
  }
}
