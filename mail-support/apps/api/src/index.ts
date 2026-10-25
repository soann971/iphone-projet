import { createContext } from "@ms/app";
import { disconnectDb } from "@ms/db";
import { buildServer } from "./server";

process.env.SERVICE_NAME ??= "api";
const ctx = createContext();
const app = await buildServer(ctx);
await app.listen({ host: "0.0.0.0", port: ctx.env.API_PORT });

async function shutdown() {
  await app.close();
  await ctx.queues.close();
  await ctx.queues.connection.quit();
  await disconnectDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
