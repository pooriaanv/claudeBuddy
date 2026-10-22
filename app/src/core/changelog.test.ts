import { describe, expect, it } from "vitest";
import { compareVersions, parseChangelog, renderNotes, unseenSections } from "./changelog";
// The real file, as the app bundles it.
import changelog from "../../../CHANGELOG.md?raw";

const SAMPLE = `# Changelog

Intro text.

## 0.4.0 — 2026-11-01

- **New:** a thing, with \`code\` and a [link](https://example.com).
  Continued on the next line.
  - A nested point.
- Another point.

## 0.3.1 — 2026-10-21

- A fix.

## 0.3.0 — 2026-10-21

Some paragraph.
`;

describe("changelog", () => {
  it("parsesTheSectionsNewestFirst", () => {
    const s = parseChangelog(SAMPLE);
    expect(s.map((x) => x.version)).toEqual(["0.4.0", "0.3.1", "0.3.0"]);
    expect(s[0].date).toBe("2026-11-01");
    expect(s[0].body.startsWith("- **New:**")).toBe(true);
  });

  it("comparesVersionsNumerically", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("0.3.1", "0.3.1")).toBe(0);
    expect(compareVersions("0.3.0", "0.3.1")).toBe(-1);
  });

  it("showsEverythingSinceTheVersionTheUserHad", () => {
    const s = parseChangelog(SAMPLE);
    expect(unseenSections(s, "0.3.0", "0.4.0").map((x) => x.version)).toEqual(["0.4.0", "0.3.1"]);
    expect(unseenSections(s, "0.3.1", "0.4.0").map((x) => x.version)).toEqual(["0.4.0"]);
    expect(unseenSections(s, null, "0.4.0").map((x) => x.version)).toEqual(["0.4.0"]);
    expect(unseenSections(s, "0.4.0", "0.4.0")).toEqual([]);
  });

  it("rendersListsBoldCodeAndNoLinks", () => {
    const html = renderNotes(parseChangelog(SAMPLE)[0].body);
    expect(html).toBe(
      "<ul><li><strong>New:</strong> a thing, with <code>code</code> and a link. Continued on the next line.</li>" +
        "<ul><li>A nested point.</li></ul><li>Another point.</li></ul>",
    );
    expect(renderNotes("Some paragraph.")).toBe("<p>Some paragraph.</p>");
  });

  it("escapesMarkup", () => {
    expect(renderNotes("- <img src=x onerror=alert(1)>")).toBe("<ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>");
  });

  it("theRealChangelogParsesAndHasTheAppVersion", async () => {
    const pkg = (await import("../../package.json")).default as { version: string };
    const sections = parseChangelog(changelog);
    expect(sections.length).toBeGreaterThan(5);
    expect(sections[0].version).toBe(pkg.version);
    for (const s of sections) expect(renderNotes(s.body).length).toBeGreaterThan(0);
  });
});
