import { connectNodeAdapter } from "@connectrpc/connect-node";
import http from "node:http";
import { prisma } from "./db.js";
import { createRoutes } from "./routes.js";

const PORT = Number(process.env.PORT ?? 50051);

// Create Connect Node HTTP Handler with CORS headers
const handler = connectNodeAdapter({
  routes: createRoutes(),
});

const server = http.createServer((req, res) => {
  // CORS setup for Frontend / GraphQL origins
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Connect-Content-Encoding, Connect-Accept-Encoding",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  handler(req, res);
});

server.listen(PORT, () => {
  console.log(
    `🚀 gRPC / Connect Microservice is running on http://localhost:${PORT}`,
  );
});

// Close the HTTP server and database pool cleanly (Ctrl+C, docker stop).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
