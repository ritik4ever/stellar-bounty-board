import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createBountySchema,
  reserveBountySchema,
  submitBountySchema,
  disputeBountySchema,
  maintainerActionSchema,
  updateNotesSchema,
  extendDeadlineSchema,
} from '../../src/validation/schemas';
import { createBountySchema as createBountySchemaSrc } from '../../src/schemas';

// Seed corpus of known-tricky inputs
const trickyInputs = [
  null,
  undefined,
  "",
  " ",
  "a".repeat(100000), // very long string
  "😂🔥".repeat(10000), // unicode
  { deeply: { nested: { object: { with: { arrays: [1, 2, "3"] } } } } },
  [],
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  NaN,
  Infinity,
  -Infinity,
  "NaN",
  "Infinity",
  "null",
  "undefined",
  "{}",
  "[]",
  "0",
  "1",
  "-1",
  true,
  false,
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', // Valid stellar address
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' + 'A', // invalid stellar address length
];

const schemas = [
  { name: 'createBountySchema (validation)', schema: createBountySchema },
  { name: 'createBountySchema (src)', schema: createBountySchemaSrc },
  { name: 'reserveBountySchema', schema: reserveBountySchema },
  { name: 'submitBountySchema', schema: submitBountySchema },
  { name: 'disputeBountySchema', schema: disputeBountySchema },
  { name: 'maintainerActionSchema', schema: maintainerActionSchema },
  { name: 'updateNotesSchema', schema: updateNotesSchema },
  { name: 'extendDeadlineSchema', schema: extendDeadlineSchema },
];

describe('Zod Schema Fuzzing', () => {
  schemas.forEach(({ name, schema }) => {
    describe(`${name}`, () => {
      it('should never throw an unhandled exception for arbitrary JSON-like inputs', () => {
        // Run bounded number of fuzz runs
        // We use 1000 in CI and 100 locally to maintain bounded runtime without timeouts
        fc.assert(
          fc.property(fc.anything(), (input) => {
            expect(() => {
              schema.safeParse(input);
            }).not.toThrow();
            return true;
          }),
          {
            numRuns: process.env.CI ? 1000 : 100, // bounded fuzz run
            examples: trickyInputs.map(t => [t]),
          }
        );
      });
      
      it('should safely parse or reject the tricky corpus without throwing', () => {
        for (const input of trickyInputs) {
          expect(() => {
            schema.safeParse(input);
          }).not.toThrow();
        }
      });
    });
  });
});
