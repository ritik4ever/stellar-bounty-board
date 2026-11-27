import { Router, Request, Response } from 'express';
import { parse, validate, execute } from 'graphql';
import { schema } from './schema';
import { resolvers } from './resolvers';
import { validateQueryComplexity, DEFAULT_MAX_DEPTH, DEFAULT_MAX_COMPLEXITY } from './complexity';

export { schema } from './schema';
export { resolvers } from './resolvers';
export { validateQueryComplexity } from './complexity';

export interface GraphQLHandlerOptions {
  maxDepth?: number;
  maxComplexity?: number;
}

/**
 * Creates an Express router mounted at /graphql to serve the GraphQL API layer alongside REST (#789).
 */
export function createGraphQLRouter(options: GraphQLHandlerOptions = {}): Router {
  const router = Router();
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxComplexity = options.maxComplexity ?? DEFAULT_MAX_COMPLEXITY;

  const handleRequest = async (req: Request, res: Response) => {
    const query = req.body?.query || req.query?.query;
    const rawVariables = req.body?.variables || req.query?.variables;
    const operationName = req.body?.operationName || req.query?.operationName;

    if (!query || typeof query !== 'string' || !query.trim()) {
      res.status(400).json({
        errors: [{ message: 'GraphQL request must contain a non-empty "query" string.' }],
      });
      return;
    }

    let document;
    try {
      document = parse(query);
    } catch (err) {
      res.status(400).json({
        errors: [
          { message: err instanceof Error ? err.message : 'Syntax Error in GraphQL query.' },
        ],
      });
      return;
    }

    // Schema validation
    const validationErrors = validate(schema, document);
    if (validationErrors.length > 0) {
      res.status(400).json({
        errors: validationErrors.map((e) => ({ message: e.message })),
      });
      return;
    }

    // Complexity and depth validation
    const complexityCheck = validateQueryComplexity(document, {
      maxDepth,
      maxComplexity,
    });

    if (!complexityCheck.valid) {
      res.status(400).json({
        errors: [{ message: complexityCheck.error }],
      });
      return;
    }

    let variables: Record<string, unknown> | undefined;
    if (typeof rawVariables === 'string') {
      try {
        variables = JSON.parse(rawVariables);
      } catch {
        res.status(400).json({
          errors: [{ message: 'Invalid JSON string provided for variables.' }],
        });
        return;
      }
    } else if (typeof rawVariables === 'object' && rawVariables !== null) {
      variables = rawVariables as Record<string, unknown>;
    }

    try {
      const result = await execute({
        schema,
        document,
        rootValue: resolvers,
        variableValues: variables,
        operationName: typeof operationName === 'string' ? operationName : undefined,
      });

      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({
        errors: [
          { message: err instanceof Error ? err.message : 'Internal GraphQL execution error.' },
        ],
      });
    }
  };

  router.get('/', handleRequest);
  router.post('/', handleRequest);

  return router;
}
