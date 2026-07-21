// `npm run electron:dev` entry point. Starts a Vite dev server
// programmatically (so we don't have to guess/hardcode a port that might
// already be taken by a plain `npm run dev` in another terminal) and
// launches Electron pointed at it. Closing the Electron app shuts the dev
// server down too.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import electronPath from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = await createServer({
  root: path.resolve(__dirname, ".."),
  configFile: path.resolve(__dirname, "../vite.config.ts"),
});
await server.listen();

const address = server.httpServer?.address();
if (!address || typeof address === "string") {
  throw new Error("Could not determine dev server address");
}
const url = `http://localhost:${address.port}`;
console.log(`[electron:dev] Vite dev server running at ${url}`);

// ELECTRON_RUN_AS_NODE (set in some shells/CI, including this one) forces
// any electron.exe invocation to behave as plain Node instead of launching
// the Electron runtime — which would make `require("electron")` in
// main.cjs come back without app/BrowserWindow/etc. Strip it for the child.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname, "main.cjs"), "--url", url], {
  stdio: "inherit",
  env: childEnv,
});

child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", async () => {
  child.kill();
});
