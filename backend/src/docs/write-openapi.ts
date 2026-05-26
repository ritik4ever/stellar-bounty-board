import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { generateOpenApiDocument } from "./openapi";

const outputPath = resolve(__dirname, "../../../docs/openapi.generated.json");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(generateOpenApiDocument(), null, 2)}\n`);

console.log(`OpenAPI spec written to ${outputPath}`);
