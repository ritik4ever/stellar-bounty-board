import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateOpenApiDocument } from "../src/docs/openapi";

const doc = generateOpenApiDocument();
const outputPath = resolve(__dirname, "../../docs/openapi.generated.json");
writeFileSync(outputPath, JSON.stringify(doc, null, 2), "utf-8");
console.log(`OpenAPI spec written to ${outputPath}`);
