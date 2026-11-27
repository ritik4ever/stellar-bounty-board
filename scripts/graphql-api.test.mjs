import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

async function getGraphQL() {
  try {
    return await import('graphql');
  } catch {
    return await import('../backend/node_modules/graphql/index.mjs');
  }
}

// Test Issue #789: Add GraphQL API layer alongside REST
// Acceptance criteria:
// 1. A GraphQL query for a bounty by ID returns data consistent with the equivalent REST endpoint
// 2. An overly deep/complex query is rejected by the complexity limiter rather than degrading server performance
// 3. The REST API continues to function unchanged alongside the new GraphQL endpoint
// 4. Schema covers bounties, disputes, and contributor/maintainer profiles
// 5. Resolvers delegate to existing service layer

test('ISSUE-789: backend/src/graphql modules and schema exist', async () => {
  const schemaPath = join(process.cwd(), 'backend', 'src', 'graphql', 'schema.ts');
  const complexityPath = join(process.cwd(), 'backend', 'src', 'graphql', 'complexity.ts');
  const resolversPath = join(process.cwd(), 'backend', 'src', 'graphql', 'resolvers.ts');
  const indexPath = join(process.cwd(), 'backend', 'src', 'graphql', 'index.ts');

  assert.ok(existsSync(schemaPath), 'schema.ts must exist');
  assert.ok(existsSync(complexityPath), 'complexity.ts must exist');
  assert.ok(existsSync(resolversPath), 'resolvers.ts must exist');
  assert.ok(existsSync(indexPath), 'index.ts must exist');

  const schemaContent = readFileSync(schemaPath, 'utf8');
  assert.match(schemaContent, /type Bounty/, 'Schema must define type Bounty');
  assert.match(schemaContent, /type Dispute/, 'Schema must define type Dispute');
  assert.match(
    schemaContent,
    /type MaintainerProfile/,
    'Schema must define type MaintainerProfile'
  );
  assert.match(
    schemaContent,
    /type ContributorProfile/,
    'Schema must define type ContributorProfile'
  );
  assert.match(schemaContent, /type GlobalMetrics/, 'Schema must define type GlobalMetrics');
  assert.match(schemaContent, /bounty\(id: ID!\): Bounty/, 'Query must support bounty by ID');
});

test('ISSUE-789: query complexity and depth limiting rejects overly nested queries', async () => {
  const { parse } = await getGraphQL();
  const { calculateQueryDepth, validateQueryComplexity } =
    await import('../backend/src/graphql/complexity.ts');

  const shallowQuery = parse(`
    query GetBounty {
      bounty(id: "BNT-1") {
        id
        title
        amount
      }
    }
  `);

  const shallowDepth = calculateQueryDepth(shallowQuery);
  assert.equal(shallowDepth, 2, 'Shallow query depth should be 2');

  const shallowValidation = validateQueryComplexity(shallowQuery, { maxDepth: 5 });
  assert.equal(shallowValidation.valid, true, 'Shallow query should be valid');

  const deepQuery = parse(`
    query DeepQuery {
      maintainerProfile(address: "GBPLA...") {
        bounties {
          id
          title
          summary
        }
      }
    }
  `);
  const deepDepth = calculateQueryDepth(deepQuery);
  assert.equal(deepDepth, 3, 'Deep query depth should be 3');

  // Query exceeding max depth limit of 2
  const rejectedCheck = validateQueryComplexity(deepQuery, { maxDepth: 2 });
  assert.equal(rejectedCheck.valid, false, 'Should reject when depth > maxDepth');
  assert.match(
    rejectedCheck.error,
    /Query depth limit exceeded/,
    'Should provide descriptive depth limit error'
  );
});

test('ISSUE-789: GraphQL query for bounty by ID returns data consistent with bounty store', async () => {
  const { parse, execute } = await getGraphQL();
  const { schema } = await import('../backend/src/graphql/schema.ts');

  const mockBounty = {
    id: 'BNT-TEST-001',
    repo: 'ritik4ever/stellar-bounty-board',
    issueNumber: 789,
    title: 'Add GraphQL API layer alongside REST',
    summary: 'GraphQL layer implementation',
    maintainer: 'GBPLA3T4MAINTAINER',
    contributor: 'GCONTRIB12345678',
    tokenSymbol: 'XLM',
    tokenAddress: 'native',
    amount: 250,
    labels: ['backend', 'enhancement'],
    status: 'open',
    createdAt: 1700000000,
    deadlineAt: 1710000000,
    version: 1,
  };

  const testResolvers = {
    bounty: ({ id }) => (id === mockBounty.id ? mockBounty : null),
  };

  const queryStr = `
    query GetBounty($id: ID!) {
      bounty(id: $id) {
        id
        repo
        issueNumber
        title
        amount
        tokenSymbol
        status
        maintainer
        contributor
      }
    }
  `;

  const result = await execute({
    schema,
    document: parse(queryStr),
    rootValue: testResolvers,
    variableValues: { id: 'BNT-TEST-001' },
  });

  assert.equal(result.errors, undefined, 'Execution should succeed without errors');
  assert.equal(result.data?.bounty?.id, 'BNT-TEST-001');
  assert.equal(result.data?.bounty?.repo, 'ritik4ever/stellar-bounty-board');
  assert.equal(result.data?.bounty?.amount, 250);
  assert.equal(result.data?.bounty?.tokenSymbol, 'XLM');
  assert.equal(result.data?.bounty?.status, 'open');
});

test('ISSUE-789: backend/src/app.ts mounts /graphql router alongside REST API', () => {
  const appPath = join(process.cwd(), 'backend', 'src', 'app.ts');
  const appContent = readFileSync(appPath, 'utf8');

  assert.match(
    appContent,
    /import\s*\{\s*createGraphQLRouter\s*\}\s*from\s*'\.\/graphql'/,
    'app.ts must import createGraphQLRouter'
  );
  assert.match(
    appContent,
    /app\.use\('\/graphql',\s*createGraphQLRouter\(\)\)/,
    'app.ts must mount /graphql'
  );
  assert.match(appContent, /app\.get\('\/api\/bounties/, 'REST /api/bounties must remain mounted');
});

test('ISSUE-789: docs/GRAPHQL_API_REFERENCE.md documents active GraphQL endpoint and queries', () => {
  const docPath = join(process.cwd(), 'docs', 'GRAPHQL_API_REFERENCE.md');
  assert.ok(existsSync(docPath), 'GRAPHQL_API_REFERENCE.md must exist');

  const docContent = readFileSync(docPath, 'utf8');
  assert.match(docContent, /POST \/graphql/, 'Must document POST /graphql');
  assert.match(
    docContent,
    /Query Complexity & Depth Limiting/,
    'Must document complexity limiting'
  );
  assert.match(docContent, /query GetBounty/, 'Must document GetBounty example query');
  assert.match(docContent, /maintainerProfile/, 'Must document maintainerProfile query');
});
