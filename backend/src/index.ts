import "dotenv/config";
import { app } from "./app";
import { logStructured } from "./logger";

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  logStructured("info", "server_listen", { port });
});
