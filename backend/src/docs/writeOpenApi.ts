import fs from "node:fs";
import path from "node:path";
import { generateOpenApiDocument } from "./openapi";
import { logger } from "../logger";

const outputPath = path.resolve(process.cwd(), "../docs/openapi.generated.json");
const document = generateOpenApiDocument();

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

logger.info(
  { outputPath: path.relative(path.resolve(process.cwd(), ".."), outputPath) },
  "Generated OpenAPI spec",
);
