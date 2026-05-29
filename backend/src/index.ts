import "dotenv/config";
import { app } from "./app";
import { logStructured } from "./logger";
import { validateBountyStorePath } from "./services/bountyStore";

const port = Number(process.env.PORT ?? 3001);

validateBountyStorePath();

app.listen(port, () => {
  logStructured("info", "server_listen", { port });
});
