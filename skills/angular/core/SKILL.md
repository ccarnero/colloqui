---
name: angular-core
description: >
  Angular core patterns: standalone components, signals, inject, control flow, zoneless.
  Trigger: When creating Angular components, using signals, or setting up zoneless.
metadata:
  
  version: "1.0"
---

> **Applies to `services/admin-console`** (`@angular/core: ^21.2.0`), the only
> Angular app in this repo. Standalone components, signals, `input()`/`output()`
> and `OnPush` are exactly what `AGENTS.md` → "Binding styles per surface"
> requires, so this page is aligned. For admin-console's own conventions
> (tokens, shell, sub-nav) read the `yz-ui` skill.
>
> One caveat, checked 2026-08-03: the **Zoneless** section below is setup advice
> for an app being migrated. admin-console needs none of it — it has no `zone.js`
> dependency, no `polyfills` entry in `angular.json` and no
> `provideZonelessChangeDetection()` call; on Angular 21 that is already the
> default. Nothing to uninstall, nothing to add.

## Standalone Components (REQUIRED)

Components are standalone by default, so `standalone: true` is redundant on
Angular 21.

**But write it anyway in `admin-console`** — that is the house convention and
`AGENTS.md` binds you to "follow the file you are editing, not personal taste".
Checked 2026-08-03: `standalone: true` appears **103** times across **137**
`@Component(` declarations under `services/admin-console/src`, and the repo's
own component skeleton (`skills/yz-ui/assets/component-template.angular.ts`)
sets it. Do not strip it from existing components as drive-by cleanup, and do
not omit it in a file whose siblings have it.

```typescript
@Component({
  selector: 'app-user',
  standalone: true,          // redundant on v21, but the house convention here
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`
})
export class UserComponent {}
```

---

## Input/Output Functions (REQUIRED)

```typescript
// ✅ ALWAYS: Function-based
readonly user = input.required<User>();
readonly disabled = input(false);
readonly selected = output<User>();
readonly checked = model(false);  // Two-way binding

// ❌ NEVER: Decorators
@Input() user: User;
@Output() selected = new EventEmitter<User>();
```

---

## Signals for State (REQUIRED)

```typescript
readonly count = signal(0);
readonly doubled = computed(() => this.count() * 2);

// Update
this.count.set(5);
this.count.update(prev => prev + 1);

// Side effects
effect(() => localStorage.setItem('count', this.count().toString()));
```

---

## NO Lifecycle Hooks (REQUIRED)

Signals replace lifecycle hooks. Do NOT use `ngOnInit`, `ngOnChanges`, `ngOnDestroy`.

```typescript
// ❌ NEVER: Lifecycle hooks
ngOnInit() {
  this.loadUser();
}

ngOnChanges(changes: SimpleChanges) {
  if (changes['userId']) {
    this.loadUser();
  }
}

// ✅ ALWAYS: Signals + effect
readonly userId = input.required<string>();
readonly user = signal<User | null>(null);

private userEffect = effect(() => {
  // Runs automatically when userId() changes
  this.loadUser(this.userId());
});

// ✅ For derived data, use computed
readonly displayName = computed(() => this.user()?.name ?? 'Guest');
```

### When to Use What

| Need | Use |
|------|-----|
| React to input changes | `effect()` watching the input signal |
| Derived/computed state | `computed()` |
| Side effects (API calls, localStorage) | `effect()` |
| Cleanup on destroy | `DestroyRef` + `inject()` |

```typescript
// Cleanup example
private readonly destroyRef = inject(DestroyRef);

constructor() {
  const subscription = someObservable$.subscribe();
  this.destroyRef.onDestroy(() => subscription.unsubscribe());
}
```

---

## inject() Over Constructor (REQUIRED)

```typescript
// ✅ ALWAYS
private readonly http = inject(HttpClient);

// ❌ NEVER
constructor(private http: HttpClient) {}
```

---

## Native Control Flow (REQUIRED)

```html
@if (loading()) {
  <spinner />
} @else {
  @for (item of items(); track item.id) {
    <item-card [data]="item" />
  } @empty {
    <p>No items</p>
  }
}

@switch (status()) {
  @case ('active') { <span>Active</span> }
  @default { <span>Unknown</span> }
}
```

---

## RxJS - Only When Needed

Signals are the default. Use RxJS ONLY for complex async operations.

| Use Signals | Use RxJS |
|-------------|----------|
| Component state | Combining multiple streams |
| Derived values | Debounce/throttle |
| Simple async (single API call) | Race conditions |
| Input/Output | WebSockets, real-time |
| | Complex error retry logic |

```typescript
// ✅ Simple API call - use signals
readonly user = signal<User | null>(null);
readonly loading = signal(false);

async loadUser(id: string) {
  this.loading.set(true);
  this.user.set(await firstValueFrom(this.http.get<User>(`/api/users/${id}`)));
  this.loading.set(false);
}

// ✅ Complex stream - use RxJS
readonly searchResults$ = this.searchTerm$.pipe(
  debounceTime(300),
  distinctUntilChanged(),
  switchMap(term => this.http.get<Results>(`/api/search?q=${term}`))
);

// Convert to signal when needed in template
readonly searchResults = toSignal(this.searchResults$, { initialValue: [] });
```

---

## Zoneless Angular (REQUIRED)

Angular is zoneless. Use `provideZonelessChangeDetection()`.

```typescript
bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()]
});
```

Remove ZoneJS:
```bash
npm uninstall zone.js
```

Remove from `angular.json` polyfills: `zone.js` and `zone.js/testing`.

### Zoneless Requirements
- Use `OnPush` change detection
- Use signals for state (auto-notifies Angular)
- Use `AsyncPipe` for observables
- Use `markForCheck()` when needed

---

## Resources

- https://angular.dev/guide/signals
- https://angular.dev/guide/templates/control-flow
- https://angular.dev/guide/zoneless
