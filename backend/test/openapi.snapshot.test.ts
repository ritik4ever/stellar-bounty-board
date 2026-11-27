import { describe, it, expect } from 'vitest';
import { generateOpenApiDocument } from '../src/docs/openapi';

/**
 * OpenAPI Snapshot Test
 *
 * This test captures the current OpenAPI spec to detect unintended changes.
 * It works alongside the live-route validation test (openapi.contract.test.ts)
 * to catch both generation drift and route drift.
 *
 * UPDATING THE SNAPSHOT:
 * When you intentionally modify the API (add/remove routes, change schemas, etc.):
 * 1. Review the changes to ensure they are intentional
 * 2. Update the snapshot by running:
 *    npm run test -- -u
 *    or
 *    vitest run -u
 * 3. Commit the updated snapshot file with your API changes
 *
 * The snapshot file is located at: test/__snapshots__/openapi.snapshot.test.ts.snap
 *
 * This test will fail if:
 * - Routes are added/removed without updating the snapshot
 * - Schemas are modified without updating the snapshot
 * - OpenAPI metadata changes without updating the snapshot
 */
describe('OpenAPI spec snapshot test', () => {
  it('generated OpenAPI spec matches snapshot', () => {
    const document = generateOpenApiDocument();
    
    expect(document).toMatchSnapshot();
  });
});
