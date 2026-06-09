import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";

export interface ISkillFile {
  name: string;
  path: string;
  type: "script" | "reference" | "asset";
  content: string;
}

export interface ISkill {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string;
  color: string;
  trigger_commands: string[];
  files?: ISkillFile[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ISkillListResponse {
  skills: ISkill[];
  total: number;
}

export interface ICreateSkillPayload {
  name: string;
  description?: string;
  system_prompt: string;
  icon?: string;
  color?: string;
  trigger_commands?: string[];
  when_to_use?: string;
  priority?: number;
  allowed_tools?: string[];
  mode?: string;
  files?: ISkillFile[];
}

export type IUpdateSkillPayload = Partial<ICreateSkillPayload> & {
  is_active?: boolean;
};

@Injectable({ providedIn: "root" })
export class SkillsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/skills`;

  list(): Observable<ISkillListResponse> {
    return this.http.get<ISkillListResponse>(this.base);
  }

  get(id: string): Observable<ISkill> {
    return this.http.get<ISkill>(`${this.base}/${id}`);
  }

  create(payload: ICreateSkillPayload): Observable<ISkill> {
    return this.http.post<ISkill>(this.base, payload);
  }

  update(id: string, payload: IUpdateSkillPayload): Observable<ISkill> {
    return this.http.patch<ISkill>(`${this.base}/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
