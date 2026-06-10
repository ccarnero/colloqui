import {
  Router,
  provideRouter,
  withComponentInputBinding
} from "./chunk-ANG63DFV.js";
import {
  DomRendererFactory2
} from "./chunk-CGNM7IHG.js";
import {
  provideHttpClient,
  withInterceptors
} from "./chunk-PNC2EGNJ.js";
import "./chunk-D2SN3R2G.js";
import "./chunk-VKTYZOST.js";
import {
  ANIMATION_MODULE_TYPE,
  ChangeDetectionScheduler,
  DOCUMENT,
  Injectable,
  InjectionToken,
  Injector,
  NgZone,
  RendererFactory2,
  RuntimeError,
  computed,
  inject,
  makeEnvironmentProviders,
  performanceMarkFeature,
  provideBrowserGlobalErrorListeners,
  setClassMetadata,
  signal,
  ɵɵdefineInjectable,
  ɵɵinvalidFactory
} from "./chunk-URRC3GSF.js";
import "./chunk-PJVWDKLX.js";

// node_modules/@yoizen/angular-shared/dist/auth-context.js
var AUTH_CONTEXT = new InjectionToken("AUTH_CONTEXT");

// node_modules/@yoizen/angular-shared/dist/auth-constants.js
var SYSTEM_ROLE_TENANT_ADMIN = "tenant_admin";

// node_modules/@yoizen/angular-shared/dist/auth-utils.js
function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3)
    return null;
  try {
    const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
function extractInitials(email) {
  const local = email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  if (segments.length >= 2) {
    return (segments[0][0] + segments[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}
function formatRole(role) {
  return role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// node_modules/@yoizen/angular-shared/dist/base-auth.service.js
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) {
      if (kind === "field") initializers.unshift(_);
      else descriptor[key] = _;
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  }
  return useValue ? value : void 0;
};
var BaseAuthService = (() => {
  let _classDecorators = [Injectable()];
  let _classDescriptor;
  let _classExtraInitializers = [];
  let _classThis;
  var BaseAuthService2 = class {
    static {
      _classThis = this;
    }
    static {
      const _metadata = typeof Symbol === "function" && Symbol.metadata ? /* @__PURE__ */ Object.create(null) : void 0;
      __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
      BaseAuthService2 = _classThis = _classDescriptor.value;
      if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
      __runInitializers(_classThis, _classExtraInitializers);
    }
    http;
    router;
    token = signal(null);
    /**
     * Constructor-injected `HttpClient` / `Router` so Angular 21+ resolves them
     * in DI context (Vitest/ng test). `injector.get(HttpClient)` triggers NG0203
     * with HttpClient’s factory.
     */
    constructor(http, router) {
      this.http = http;
      this.router = router;
    }
    /**
     * Call from the concrete service constructor after `super()` to hydrate the token
     * from localStorage (abstract storage keys are not available in the base ctor).
     */
    restoreTokenFromStorage() {
      this.token.set(localStorage.getItem(this.tokenStorageKey));
    }
    /** Hook after access (and optional refresh) tokens are persisted — e.g. schedule proactive refresh. */
    onAfterSetTokens(_accessToken, _refreshToken) {
    }
    /** Hook before clearing storage — e.g. clear refresh timers. */
    onBeforeLogout() {
    }
    jwtPayload = computed(() => {
      const t = this.token();
      return t ? decodeJwtPayload(t) : null;
    });
    isAuthenticated = computed(() => {
      const payload = this.jwtPayload();
      if (!payload)
        return false;
      return payload.exp * 1e3 > Date.now();
    });
    tenantId = computed(() => {
      const payload = this.jwtPayload();
      if (!payload)
        return null;
      if (payload.tenant_id)
        return payload.tenant_id;
      const { scope } = payload;
      if (scope.startsWith("tenant:"))
        return scope.slice(7);
      return null;
    });
    userRole = computed(() => {
      const payload = this.jwtPayload();
      return payload?.role ?? "viewer";
    });
    permissions = computed(() => {
      const payload = this.jwtPayload();
      const perms = payload?.permissions;
      return new Set(perms ?? []);
    });
    isAdmin = computed(() => {
      const role = this.userRole();
      if (role === SYSTEM_ROLE_TENANT_ADMIN)
        return true;
      return this.permissions().has("*");
    });
    userProfile = computed(() => {
      const payload = this.jwtPayload();
      const email = payload?.email ?? "unknown";
      return {
        id: payload?.sub ?? "",
        name: payload?.email ?? "User",
        email,
        initials: extractInitials(email),
        role: formatRole(payload?.role ?? "viewer")
      };
    });
    hasPermission(permission) {
      if (this.isAdmin())
        return true;
      return this.permissions().has(permission);
    }
    login(email, password, tenantId) {
      this.postLogin(email, password, tenantId).subscribe({
        next: (res) => {
          this.completeLogin(res);
        },
        error: () => {
        }
      });
    }
    /**
     * Observable login for UI that needs to show errors (e.g. messaging console).
     */
    postLogin(email, password, tenantId) {
      const body = { email, password };
      const headers = {};
      if (tenantId) {
        if (this.loginTenantMode === "body") {
          body["tenant_id"] = tenantId;
        } else {
          headers["x-yoizen-tenant"] = tenantId;
        }
      }
      return this.http.post(`${this.apiBaseUrl}/auth/login`, body, { headers });
    }
    completeLogin(res) {
      this.setTokens(res.access_token, res.refresh_token);
      void this.router.navigate(["/"]);
    }
    logout() {
      this.onBeforeLogout();
      localStorage.removeItem(this.tokenStorageKey);
      localStorage.removeItem(this.refreshStorageKey);
      this.token.set(null);
      void this.router.navigate(["/login"]);
    }
    refreshToken() {
      const refresh = localStorage.getItem(this.refreshStorageKey);
      if (!refresh) {
        this.logout();
        return;
      }
      this.http.post(`${this.apiBaseUrl}/auth/refresh`, {
        refresh_token: refresh
      }).subscribe({
        next: (res) => {
          this.setTokens(res.access_token, res.refresh_token);
        },
        error: () => {
          this.logout();
        }
      });
    }
    setTokens(accessToken, refreshToken) {
      localStorage.setItem(this.tokenStorageKey, accessToken);
      this.token.set(accessToken);
      if (refreshToken) {
        localStorage.setItem(this.refreshStorageKey, refreshToken);
      }
      this.onAfterSetTokens(accessToken, refreshToken);
    }
  };
  return BaseAuthService2 = _classThis;
})();

// node_modules/@yoizen/angular-shared/dist/auth.interceptor.js
var authInterceptor = (req, next) => {
  const auth = inject(AUTH_CONTEXT);
  const token = auth.token();
  if (token) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(cloned);
  }
  return next(req);
};

// node_modules/@yoizen/angular-shared/dist/tenant.interceptor.js
var tenantInterceptor = (req, next) => {
  const auth = inject(AUTH_CONTEXT);
  const tenantId = auth.tenantId();
  if (tenantId) {
    const cloned = req.clone({
      setHeaders: { "x-yoizen-tenant": tenantId }
    });
    return next(cloned);
  }
  return next(req);
};

// node_modules/@yoizen/angular-shared/dist/auth.guard.js
var authGuard = () => {
  const auth = inject(AUTH_CONTEXT);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(["/login"]);
};

// node_modules/@angular/platform-browser/fesm2022/animations-async.mjs
var ANIMATION_PREFIX = "@";
var AsyncAnimationRendererFactory = class _AsyncAnimationRendererFactory {
  doc;
  delegate;
  zone;
  animationType;
  moduleImpl;
  _rendererFactoryPromise = null;
  scheduler = null;
  injector = inject(Injector);
  loadingSchedulerFn = inject(ɵASYNC_ANIMATION_LOADING_SCHEDULER_FN, {
    optional: true
  });
  _engine;
  constructor(doc, delegate, zone, animationType, moduleImpl) {
    this.doc = doc;
    this.delegate = delegate;
    this.zone = zone;
    this.animationType = animationType;
    this.moduleImpl = moduleImpl;
  }
  ngOnDestroy() {
    this._engine?.flush();
  }
  loadImpl() {
    const loadFn = () => this.moduleImpl ?? import("./browser-43DBFDS6.js").then((m) => m);
    let moduleImplPromise;
    if (this.loadingSchedulerFn) {
      moduleImplPromise = this.loadingSchedulerFn(loadFn);
    } else {
      moduleImplPromise = loadFn();
    }
    return moduleImplPromise.catch((e) => {
      throw new RuntimeError(5300, (typeof ngDevMode === "undefined" || ngDevMode) && "Async loading for animations package was enabled, but loading failed. Angular falls back to using regular rendering. No animations will be displayed and their styles won't be applied.");
    }).then(({
      ɵcreateEngine,
      ɵAnimationRendererFactory
    }) => {
      this._engine = ɵcreateEngine(this.animationType, this.doc);
      const rendererFactory = new ɵAnimationRendererFactory(this.delegate, this._engine, this.zone);
      this.delegate = rendererFactory;
      return rendererFactory;
    });
  }
  createRenderer(hostElement, rendererType) {
    const renderer = this.delegate.createRenderer(hostElement, rendererType);
    if (renderer.ɵtype === 0) {
      return renderer;
    }
    if (typeof renderer.throwOnSyntheticProps === "boolean") {
      renderer.throwOnSyntheticProps = false;
    }
    const dynamicRenderer = new DynamicDelegationRenderer(renderer);
    if (rendererType?.data?.["animation"] && !this._rendererFactoryPromise) {
      this._rendererFactoryPromise = this.loadImpl();
    }
    this._rendererFactoryPromise?.then((animationRendererFactory) => {
      const animationRenderer = animationRendererFactory.createRenderer(hostElement, rendererType);
      dynamicRenderer.use(animationRenderer);
      this.scheduler ??= this.injector.get(ChangeDetectionScheduler, null, {
        optional: true
      });
      this.scheduler?.notify(10);
    }).catch((e) => {
      dynamicRenderer.use(renderer);
    });
    return dynamicRenderer;
  }
  begin() {
    this.delegate.begin?.();
  }
  end() {
    this.delegate.end?.();
  }
  whenRenderingDone() {
    return this.delegate.whenRenderingDone?.() ?? Promise.resolve();
  }
  componentReplaced(componentId) {
    this._engine?.flush();
    this.delegate.componentReplaced?.(componentId);
  }
  static ɵfac = function AsyncAnimationRendererFactory_Factory(__ngFactoryType__) {
    ɵɵinvalidFactory();
  };
  static ɵprov = ɵɵdefineInjectable({
    token: _AsyncAnimationRendererFactory,
    factory: _AsyncAnimationRendererFactory.ɵfac
  });
};
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(AsyncAnimationRendererFactory, [{
    type: Injectable
  }], () => [{
    type: Document
  }, {
    type: RendererFactory2
  }, {
    type: NgZone
  }, {
    type: void 0
  }, {
    type: Promise
  }], null);
})();
var DynamicDelegationRenderer = class {
  delegate;
  replay = [];
  ɵtype = 1;
  constructor(delegate) {
    this.delegate = delegate;
  }
  use(impl) {
    this.delegate = impl;
    if (this.replay !== null) {
      for (const fn of this.replay) {
        fn(impl);
      }
      this.replay = null;
    }
  }
  get data() {
    return this.delegate.data;
  }
  destroy() {
    this.replay = null;
    this.delegate.destroy();
  }
  createElement(name, namespace) {
    return this.delegate.createElement(name, namespace);
  }
  createComment(value) {
    return this.delegate.createComment(value);
  }
  createText(value) {
    return this.delegate.createText(value);
  }
  get destroyNode() {
    return this.delegate.destroyNode;
  }
  appendChild(parent, newChild) {
    this.delegate.appendChild(parent, newChild);
  }
  insertBefore(parent, newChild, refChild, isMove) {
    this.delegate.insertBefore(parent, newChild, refChild, isMove);
  }
  removeChild(parent, oldChild, isHostElement, requireSynchronousElementRemoval) {
    this.delegate.removeChild(parent, oldChild, isHostElement, requireSynchronousElementRemoval);
  }
  selectRootElement(selectorOrNode, preserveContent) {
    return this.delegate.selectRootElement(selectorOrNode, preserveContent);
  }
  parentNode(node) {
    return this.delegate.parentNode(node);
  }
  nextSibling(node) {
    return this.delegate.nextSibling(node);
  }
  setAttribute(el, name, value, namespace) {
    this.delegate.setAttribute(el, name, value, namespace);
  }
  removeAttribute(el, name, namespace) {
    this.delegate.removeAttribute(el, name, namespace);
  }
  addClass(el, name) {
    this.delegate.addClass(el, name);
  }
  removeClass(el, name) {
    this.delegate.removeClass(el, name);
  }
  setStyle(el, style, value, flags) {
    this.delegate.setStyle(el, style, value, flags);
  }
  removeStyle(el, style, flags) {
    this.delegate.removeStyle(el, style, flags);
  }
  setProperty(el, name, value) {
    if (this.shouldReplay(name)) {
      this.replay.push((renderer) => renderer.setProperty(el, name, value));
    }
    this.delegate.setProperty(el, name, value);
  }
  setValue(node, value) {
    this.delegate.setValue(node, value);
  }
  listen(target, eventName, callback, options) {
    if (this.shouldReplay(eventName)) {
      this.replay.push((renderer) => renderer.listen(target, eventName, callback, options));
    }
    return this.delegate.listen(target, eventName, callback, options);
  }
  shouldReplay(propOrEventName) {
    return this.replay !== null && propOrEventName.startsWith(ANIMATION_PREFIX);
  }
};
var ɵASYNC_ANIMATION_LOADING_SCHEDULER_FN = new InjectionToken(typeof ngDevMode !== "undefined" && ngDevMode ? "async_animation_loading_scheduler_fn" : "");
function provideAnimationsAsync(type = "animations") {
  performanceMarkFeature("NgAsyncAnimations");
  if (false) {
    type = "noop";
  }
  return makeEnvironmentProviders([{
    provide: RendererFactory2,
    useFactory: () => {
      return new AsyncAnimationRendererFactory(inject(DOCUMENT), inject(DomRendererFactory2), inject(NgZone), type);
    }
  }, {
    provide: ANIMATION_MODULE_TYPE,
    useValue: type === "noop" ? "NoopAnimations" : "BrowserAnimations"
  }]);
}

// node_modules/@yoizen/angular-shared/dist/app-providers.js
function provideCoreApp(options) {
  return [
    provideBrowserGlobalErrorListeners(),
    { provide: AUTH_CONTEXT, useExisting: options.authServiceClass },
    provideRouter(options.routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, tenantInterceptor])),
    provideAnimationsAsync()
  ];
}
export {
  AUTH_CONTEXT,
  authInterceptor as AuthInterceptor,
  BaseAuthService,
  SYSTEM_ROLE_TENANT_ADMIN,
  tenantInterceptor as TenantInterceptor,
  authGuard,
  authInterceptor,
  decodeJwtPayload,
  extractInitials,
  formatRole,
  provideCoreApp,
  tenantInterceptor
};
//# sourceMappingURL=@yoizen_angular-shared.js.map
