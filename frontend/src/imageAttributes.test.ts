import ts from "typescript";
import { describe, expect, it } from "vitest";

type ImageViolation = {
  file: string;
  missing: string[];
  tag: string;
};

const sourceFiles = import.meta.glob("./**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

function jsxAttributeValue(attribute: ts.JsxAttribute) {
  const initializer = attribute.initializer;

  if (!initializer) return true;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteral(initializer.expression)) {
    return initializer.expression.text;
  }

  return true;
}

function collectImageViolations(fileName: string, source: string) {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: ImageViolation[] = [];

  function inspectAttributes(attributes: ts.JsxAttributes, node: ts.Node) {
    const props = new Map<string, string | true>();

    for (const prop of attributes.properties) {
      if (ts.isJsxAttribute(prop)) {
        props.set(prop.name.text, jsxAttributeValue(prop));
      }
    }

    const missing = [
      props.get("loading") === "lazy" ? null : 'loading="lazy"',
      props.get("decoding") === "async" ? null : 'decoding="async"',
      props.has("width") ? null : "width",
      props.has("height") ? null : "height",
    ].filter((value): value is string => Boolean(value));

    if (missing.length > 0) {
      violations.push({
        file: fileName,
        missing,
        tag: node.getText(parsed),
      });
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "img") {
      inspectAttributes(node.attributes, node);
    }

    if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "img") {
      inspectAttributes(node.attributes, node);
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return violations;
}

describe("app image tags", () => {
  it("keeps every JSX img lazy, async decoded, and size-constrained", () => {
    const violations = Object.entries(sourceFiles).flatMap(([fileName, source]) =>
      collectImageViolations(fileName, source),
    );

    expect(violations).toEqual([]);
  });
});
