import {
  ErrorHandler,
  Injectable,
  computed,
  inject,
  signal,
} from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { AuthService } from "./auth.service";
import { environment } from "../../../environments/environment";

interface ITenantDetail {
  name: string;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: "root" })
export class TenantService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandler);

  private readonly tenantDetail = signal<ITenantDetail | null>(null);

  readonly currentTenantId = computed(() => this.authService.tenantId());

  readonly currentTenant = computed(() => {
    const detail = this.tenantDetail();
    const id = this.currentTenantId();
    return {
      id: id ?? "",
      name: detail?.name ?? id ?? "Unknown",
      configuration: detail?.configuration ?? {},
    };
  });

  /**
   * Fetches tenant details from the API once logged in.
   * Called by the shell on init or after login.
   */
  loadTenantDetails(): void {
    const id = this.currentTenantId();
    if (!id) return;

    this.http
      .get<ITenantDetail>(`${environment.apiUrl}/tenants/${id}`)
      .subscribe({
        next: (detail) => this.tenantDetail.set(detail),
        error: (err: unknown) => {
          this.errorHandler.handleError(
            err instanceof Error
              ? err
              : new Error(
                  `TenantService: failed to load tenant details: ${String(err)}`,
                ),
          );
        },
      });
  }
}
