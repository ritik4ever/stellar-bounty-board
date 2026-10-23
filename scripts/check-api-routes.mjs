import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const appPath = path.join(root, 'backend', 'src', 'app.ts');
const readmePath = path.join(root, 'README.md');
const startMarker = '<!-- API ROUTES START -->';
const endMarker = '<!-- API ROUTES END -->';
const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function getRegisteredRoutes(sourceText) {
  const sourceFile = ts.createSourceFile(appPath, sourceText, ts.ScriptTarget.Latest, true);
  const routes = new Set();

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression, name } = node.expression;
      const routePath = node.arguments[0];

      const isRouteHandler =
        ts.isIdentifier(expression) &&
        expression.text === 'app' &&
        supportedMethods.has(name.text.toLowerCase()) &&
        routePath !== undefined &&
        (ts.isStringLiteral(routePath) || ts.isNoSubstitutionTemplateLiteral(routePath));
      const isRouterMount =
        ts.isIdentifier(expression) &&
        expression.text === 'app' &&
        name.text === 'use' &&
        routePath !== undefined &&
        (ts.isStringLiteral(routePath) || ts.isNoSubstitutionTemplateLiteral(routePath));

      if (isRouteHandler || isRouterMount) {
        routes.add(`${isRouterMount ? 'MOUNT' : name.text.toUpperCase()} ${routePath.text}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...routes].sort();
}

function formatRouteTable(routes) {
  return [
    '| Method | Route |',
    '| --- | --- |',
    ...routes.map((route) => {
      const separator = route.indexOf(' ');
      return `| ${route.slice(0, separator)} | \`${route.slice(separator + 1)}\` |`;
    }),
  ].join('\n');
}

const appSource = fs.readFileSync(appPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const registeredRoutes = getRegisteredRoutes(appSource);
const generatedTable = formatRouteTable(registeredRoutes);
const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
const currentBlock = readme.match(markerPattern);

if (!currentBlock) {
  console.error(
    `Could not find the API route table markers in ${path.relative(root, readmePath)}.`
  );
  process.exit(1);
}

if (process.argv.includes('--write')) {
  const replacement = `${startMarker}\n${generatedTable}\n${endMarker}`;
  fs.writeFileSync(readmePath, readme.replace(markerPattern, replacement));
  console.log(`Updated the README API route table with ${registeredRoutes.length} routes.`);
  process.exit(0);
}

const documentedRoutes = new Set(
  [
    ...currentBlock[0].matchAll(
      /^\| (MOUNT|GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) \| `([^`]+)` \|$/gm
    ),
  ]
    .map((match) => `${match[1]} ${match[2]}`)
);
const registeredRouteSet = new Set(registeredRoutes);
const missingRoutes = registeredRoutes.filter((route) => !documentedRoutes.has(route));
const staleRoutes = [...documentedRoutes].filter((route) => !registeredRouteSet.has(route));

if (missingRoutes.length > 0 || staleRoutes.length > 0) {
  console.error('README API route table is out of sync with backend/src/app.ts.');
  for (const route of missingRoutes) {
    console.error(`Missing from README: ${route}`);
  }
  for (const route of staleRoutes) {
    console.error(`No longer registered: ${route}`);
  }
  console.error(
    'Run "node scripts/check-api-routes.mjs --write" and commit the updated README.'
  );
  process.exit(1);
}

console.log(
  `README API route table matches backend/src/app.ts (${registeredRoutes.length} routes).`
);
