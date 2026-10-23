import { describe, expect, it } from "vitest";
import { availableKeys, leadVars, renderTemplate, usedVariables } from "./template";

describe("template", () => {
  it("renders variables with fallbacks", () => {
    const vars = leadVars("ava@acme.com", { "First Name": "Ava", Company: "Acme" });
    expect(renderTemplate("Hi {{first_name}} from {{company}}, {{title|friend}}", vars)).toBe("Hi Ava from Acme, friend");
  });

  it("lists used variables and available keys", () => {
    expect(usedVariables("{{a}} {{b|x}} {{a}}")).toEqual([
      { key: "a", hasFallback: false },
      { key: "b", hasFallback: true },
    ]);
    expect(availableKeys(["Name", "Company"])).toEqual(["name", "company", "first_name", "email"]);
  });
});
