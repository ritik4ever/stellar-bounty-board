import type { DocumentNode, SelectionSetNode } from 'graphql';

export interface ComplexityOptions {
  maxDepth?: number;
  maxComplexity?: number;
}

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_MAX_COMPLEXITY = 100;

/**
 * Calculates the maximum nested selection depth of a parsed GraphQL query AST (#789).
 */
export function calculateQueryDepth(node: DocumentNode): number {
  let maxDepth = 0;

  function traverse(selectionSet: SelectionSetNode, currentDepth: number) {
    if (currentDepth > maxDepth) {
      maxDepth = currentDepth;
    }
    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field' && selection.selectionSet) {
        traverse(selection.selectionSet, currentDepth + 1);
      } else if (
        (selection.kind === 'InlineFragment' || selection.kind === 'FragmentSpread') &&
        'selectionSet' in selection &&
        selection.selectionSet
      ) {
        traverse(selection.selectionSet, currentDepth);
      }
    }
  }

  for (const def of node.definitions) {
    if (def.kind === 'OperationDefinition' && def.selectionSet) {
      traverse(def.selectionSet, 1);
    }
  }

  return maxDepth;
}

/**
 * Calculates total field selection complexity (#789).
 */
export function calculateQueryComplexity(node: DocumentNode): number {
  let complexity = 0;

  function traverse(selectionSet: SelectionSetNode, weight: number) {
    for (const selection of selectionSet.selections) {
      if (selection.kind === 'Field') {
        complexity += weight;
        if (selection.selectionSet) {
          traverse(selection.selectionSet, weight + 1);
        }
      }
    }
  }

  for (const def of node.definitions) {
    if (def.kind === 'OperationDefinition' && def.selectionSet) {
      traverse(def.selectionSet, 1);
    }
  }

  return complexity;
}

/**
 * Validates query AST against maximum depth and complexity thresholds (#789).
 */
export function validateQueryComplexity(
  node: DocumentNode,
  options: ComplexityOptions = {}
): { valid: boolean; error?: string; depth: number; complexity: number } {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxComplexity = options.maxComplexity ?? DEFAULT_MAX_COMPLEXITY;

  const depth = calculateQueryDepth(node);
  const complexity = calculateQueryComplexity(node);

  if (depth > maxDepth) {
    return {
      valid: false,
      error: `Query depth limit exceeded: depth of ${depth} exceeds maximum allowed depth of ${maxDepth}.`,
      depth,
      complexity,
    };
  }

  if (complexity > maxComplexity) {
    return {
      valid: false,
      error: `Query complexity limit exceeded: complexity of ${complexity} exceeds maximum allowed complexity of ${maxComplexity}.`,
      depth,
      complexity,
    };
  }

  return { valid: true, depth, complexity };
}
