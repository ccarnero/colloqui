import { AUTH_CONTEXT } from "@yoizen/angular-shared";

export default [
  {
    provide: AUTH_CONTEXT,
    useValue: {
      token: () => "test-token",
      tenantId: () => "test-tenant",
      isAuthenticated: () => true,
    },
  },
];
