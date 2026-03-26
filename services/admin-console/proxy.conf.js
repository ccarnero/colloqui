const MINIKUBE_IP = process.env.MINIKUBE_IP ?? "192.168.49.2";
const KOURIER_PORT = process.env.KOURIER_PORT ?? "8080";
const KNATIVE_NS = "platform-services-dev";

const gateway = {
  target: `http://localhost:${KOURIER_PORT}`,
  secure: false,
  changeOrigin: true,
  headers: {
    Host: `api-gateway.${KNATIVE_NS}.${MINIKUBE_IP}.sslip.io`,
  },
};

module.exports = {
  "/auth": gateway,
  "/tenants": gateway,
  "/events": gateway,
  "/results": gateway,
  "/adapters": gateway,
  "/channels": gateway,
  "/webhooks": gateway,
  "/workflows": gateway,
  "/registry": gateway,
  "/schedulers": gateway,
  "/audit": gateway,
  "/health": gateway,
  "/proxy": gateway,
};
