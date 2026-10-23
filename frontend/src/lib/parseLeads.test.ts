import { describe, expect, it } from "vitest";
import { parseLeadFile, parseLeads } from "./parseLeads";

describe("parseLeads", () => {
  it("extracts emails from a CSV regardless of column layout", () => {
    const csv = "name,email,company\nAva,ava@acme.com,Acme\nBen,ben@globex.io,Globex";
    expect(parseLeads(csv).emails).toEqual(["ava@acme.com", "ben@globex.io"]);
  });

  it("de-duplicates case-insensitively and counts duplicates", () => {
    const r = parseLeads("a@x.com\nA@X.com\nb@x.com");
    expect(r.emails).toEqual(["a@x.com", "b@x.com"]);
    expect(r.duplicates).toBe(1);
  });

  it("reports tokens that look like emails but are invalid", () => {
    const r = parseLeads("ok@x.com, broken@, @nouser.com, no-at-sign");
    expect(r.emails).toEqual(["ok@x.com"]);
    expect(r.invalid).toEqual(["broken@", "@nouser.com"]);
  });

  it("handles quoted cells, angle-bracket forms, semicolons and tabs", () => {
    const r = parseLeads('"Ava" <ava@acme.com>;"ben@globex.io"\tcara@initech.co');
    expect(r.emails).toEqual(["ava@acme.com", "ben@globex.io", "cara@initech.co"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseLeads("")).toEqual({ emails: [], duplicates: 0, invalid: [] });
  });
});

describe("parseLeadFile (personalization columns)", () => {
  it("keeps the other CSV columns per email", () => {
    const r = parseLeadFile('Name,Email,Company\n"Thompson, Ava",ava@acme.com,Acme\nBen Ortiz,BEN@globex.io,"Globex ""Labs"""');
    expect(r.emails).toEqual(["ava@acme.com", "ben@globex.io"]);
    expect(r.columns).toEqual(["Name", "Company"]);
    expect(r.fields["ava@acme.com"]).toEqual({ Name: "Thompson, Ava", Company: "Acme" });
    expect(r.fields["ben@globex.io"].Company).toBe('Globex "Labs"');
  });

  it("supports semicolon files and reports duplicates/invalid rows", () => {
    const r = parseLeadFile("email;first name\na@x.com;Ann\nA@X.com;Again\nnot-an-email;Bob");
    expect(r.emails).toEqual(["a@x.com"]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual(["not-an-email"]);
    expect(r.fields["a@x.com"]).toEqual({ "first name": "Ann" });
  });

  it("falls back to scanning when there is no header row", () => {
    const r = parseLeadFile("a@x.com\nb@x.com");
    expect(r.emails).toEqual(["a@x.com", "b@x.com"]);
    expect(r.columns).toEqual([]);
  });
});
