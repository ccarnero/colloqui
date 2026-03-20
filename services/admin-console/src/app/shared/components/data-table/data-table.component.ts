import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatTableModule } from "@angular/material/table";
import { MatPaginatorModule, PageEvent } from "@angular/material/paginator";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";

export interface TableColumn {
  key: string;
  label: string;
  type?: "text" | "badge" | "actions";
}

@Component({
  selector: "app-data-table",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  template: `
    <div class="table-wrap">
      @if (searchable()) {
        <div class="table-toolbar">
          <mat-form-field appearance="outline" class="search-field">
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              placeholder="Search..."
              [ngModel]="searchTerm()"
              (ngModelChange)="searchTerm.set($event)"
            />
          </mat-form-field>
          <ng-content select="[toolbar]" />
        </div>
      }
      <ng-content />
      @if (showPaginator()) {
        <mat-paginator
          [length]="totalItems()"
          [pageSize]="pageSize()"
          [pageSizeOptions]="[10, 25, 50]"
          (page)="onPage($event)"
          showFirstLastButtons
        />
      }
    </div>
  `,
  styles: `
    .search-field {
      width: 260px;
    }

    :host ::ng-deep .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }
  `,
})
export class DataTableComponent {
  readonly searchable = input(true);
  readonly showPaginator = input(true);
  readonly totalItems = input(0);
  readonly pageSize = input(10);
  readonly pageChange = output<PageEvent>();

  readonly searchTerm = signal("");

  onPage(event: PageEvent): void {
    this.pageChange.emit(event);
  }
}
