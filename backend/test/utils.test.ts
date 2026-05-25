
import { describe, expect, it } from "vitest";

import { limiter } from "../src/utils";

describe("utils", () => {
  it("exports the rate limiter middleware", () => {
    expect(typeof limiter).toBe("function");
  });
});
