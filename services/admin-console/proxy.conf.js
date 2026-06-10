const KOURIER_PORT = process.env.KOURIER_PORT ?? "8080";
const KNATIVE_NS = "platform-services-dev";
// DEV_DOMAIN is the canonical env var; MINIKUBE_DOMAIN accepted as a
// backward-compat fallback so existing scripts keep working.
const DEV_DOMAIN = process.env.DEV_DOMAIN ?? process.env.MINIKUBE_DOMAIN ?? "dev.local";

const gateway = {
  target: `http://localhost:${KOURIER_PORT}`,
  secure: false,
  changeOrigin: true,
  headers: {
    Host: `api-gateway.${KNATIVE_NS}.${DEV_DOMAIN}`,
    "x-yoizen-tenant": "acme",
  },
};

module.exports = {
  "/api": gateway,
  "/health": gateway,
};
