import "dotenv/config";
import { app } from "./app";
import { logStructured } from "./logger";

const port = Number(process.env.PORT ?? 3001);
const keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT ?? 65000);
const headersTimeout = Number(process.env.HEADERS_TIMEOUT ?? 66000);

const server = app.listen(port, () => {
  logStructured("info", "server_listen", { port, keepAliveTimeout, headersTimeout });
});

server.keepAliveTimeout = keepAliveTimeout;
server.headersTimeout = headersTimeout;
