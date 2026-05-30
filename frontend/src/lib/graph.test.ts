import { describe, expect, test } from "vitest";

describe("frontend smoke", () => {
  test("environment is wired", () => {
    expect(document.createElement("div")).toBeTruthy();
  });
});
