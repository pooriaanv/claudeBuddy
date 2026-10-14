// port of Tests/BuddyCoreTests/UpdateTests.swift (Mac reference v0.0.9)

import { describe, expect, it } from "vitest";
import { ReleaseInfo, SemanticVersion } from "./updates";

describe("UpdateTests", () => {
  function v(s: string): SemanticVersion {
    const parsed = SemanticVersion.parse(s);
    if (parsed === null) throw new Error(`not a version: ${s}`);
    return parsed;
  }

  it("versionsCompareNumerically", () => {
    expect(v("0.0.2").compareTo(v("0.0.1"))).toBeGreaterThan(0);
    expect(v("0.10.0").compareTo(v("0.9.9"))).toBeGreaterThan(0);
    expect(v("v1.2").equals(v("1.2.0"))).toBe(true);
    expect(v("1.0.0-beta").equals(v("1.0.0"))).toBe(true);
    expect(SemanticVersion.parse("latest")).toBeNull();
    expect(SemanticVersion.parse("")).toBeNull();
    expect(v("v1.2").toString()).toBe("1.2");
  });

  it("parsesLatestRelease", () => {
    const json = `
    {"tag_name": "v0.0.2", "draft": false, "prerelease": false,
     "html_url": "https://github.com/o/r/releases/tag/v0.0.2",
     "assets": [
       {"name": "notes.txt", "browser_download_url": "https://example.com/notes.txt"},
       {"name": "ClaudeBuddy-0.0.2.zip", "digest": "sha256:ABC123",
        "browser_download_url": "https://github.com/o/r/releases/download/v0.0.2/ClaudeBuddy-0.0.2.zip"}
     ]}
    `;
    const r = ReleaseInfo.parse(json);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.version.equals(v("0.0.2"))).toBe(true);
    expect(new URL(r.zipURL).pathname.split("/").pop()).toBe("ClaudeBuddy-0.0.2.zip");
    expect(r.sha256).toBe("abc123");
    expect(r.pageURL).toBe("https://github.com/o/r/releases/tag/v0.0.2");
  });

  it("rejectsReleasesWithoutAUsableZip", () => {
    const noZip = '{"tag_name": "v1.0.0", "assets": [{"name": "x.dmg", "browser_download_url": "https://e.com/x.dmg"}]}';
    const insecure =
      '{"tag_name": "v1.0.0", "assets": [{"name": "ClaudeBuddy-1.0.0.zip", "browser_download_url": "http://e.com/a.zip"}]}';
    const prerelease =
      '{"tag_name": "v1.0.0", "prerelease": true, "assets": [{"name": "ClaudeBuddy-1.0.0.zip", "browser_download_url": "https://e.com/a.zip"}]}';
    expect(ReleaseInfo.parse(noZip)).toBeNull();
    expect(ReleaseInfo.parse(insecure)).toBeNull();
    expect(ReleaseInfo.parse(prerelease)).toBeNull();
  });

  it("assetPredicateSelectsTheAsset", () => {
    const json =
      '{"tag_name": "v1.0.0", "assets": [{"name": "ClaudeBuddy-1.0.0.zip", "browser_download_url": "https://e.com/a.zip"},' +
      '{"name": "ClaudeBuddy-1.0.0-x64.msi", "browser_download_url": "https://e.com/b.msi"}]}';
    expect(ReleaseInfo.parse(json)?.zipURL).toBe("https://e.com/a.zip");
    expect(ReleaseInfo.parse(json, (n) => n.endsWith(".msi"))?.zipURL).toBe("https://e.com/b.msi");
    expect(ReleaseInfo.parse(json, () => false)).toBeNull();
    expect(ReleaseInfo.parse("[]")).toBeNull();
    expect(ReleaseInfo.parse("not json")).toBeNull();
  });
});
