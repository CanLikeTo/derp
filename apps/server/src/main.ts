import { startServer } from "./server";
const running = await startServer();
console.log(`dERP authoritative room: http://127.0.0.1:${running.server.port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    running.stop();
    process.exit(0);
  });
