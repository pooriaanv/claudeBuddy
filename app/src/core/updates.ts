// port of Sources/BuddyCore/Updates.swift (Mac reference v0.0.9)

import { parseJSONObject, trimWhitespacesAndNewlines } from "./inbox";

/// "0.0.2", "v1.2" ... compared numerically, missing parts count as 0. Pre-release suffixes ("-beta") are ignored.
export class SemanticVersion {
  readonly parts: readonly number[];

  private constructor(parts: readonly number[]) {
    this.parts = parts;
  }

  // port of Updates.swift SemanticVersion.init?(_:)
  /// Swift failable init: null when the string isn't a dotted list of integers.
  static parse(string: string): SemanticVersion | null {
    let s = trimWhitespacesAndNewlines(string);
    if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
    const end = s.search(/[-+]/);
    if (end >= 0) s = s.slice(0, end);
    // Swift `split(separator: ".")` omits empty pieces ("1..2" -> ["1", "2"]).
    const pieces = s.split(".").filter((p) => p !== "");
    if (pieces.length === 0) return null;
    const parts: number[] = [];
    for (const p of pieces) {
      if (!/^[0-9]+$/.test(p)) return null;
      const n = Number(p);
      // Swift `Int` also rejects overflow; JS can only hold safe integers exactly.
      if (!Number.isSafeInteger(n)) return null;
      parts.push(n);
    }
    return new SemanticVersion(parts);
  }

  toString(): string {
    return this.parts.map(String).join(".");
  }

  /// Swift `<`.
  lessThan(b: SemanticVersion): boolean {
    const count = Math.max(this.parts.length, b.parts.length);
    for (let i = 0; i < count; i++) {
      const x = i < this.parts.length ? this.parts[i] : 0;
      const y = i < b.parts.length ? b.parts[i] : 0;
      if (x !== y) return x < y;
    }
    return false;
  }

  /// Swift `==` (numeric: "1.2" == "1.2.0").
  equals(b: SemanticVersion): boolean {
    return !this.lessThan(b) && !b.lessThan(this);
  }

  /// -1 / 0 / 1, usable as a sort comparator.
  compareTo(b: SemanticVersion): number {
    return this.lessThan(b) ? -1 : b.lessThan(this) ? 1 : 0;
  }
}

/// The parts of a GitHub "latest release" response the updater needs.
export interface ReleaseInfo {
  tag: string;
  version: SemanticVersion;
  /// The chosen asset's `browser_download_url` (https only).
  zipURL: string;
  /// Hex SHA-256 of the zip, from GitHub's asset digest, when available.
  sha256?: string;
  pageURL?: string;
}

/// The Mac asset rule: `ClaudeBuddy-*.zip` (Swift's `assetPrefix: "ClaudeBuddy-"`).
export function isMacReleaseAsset(name: string): boolean {
  return name.startsWith("ClaudeBuddy-") && name.endsWith(".zip");
}

/// Swift `URL(string:)`: a valid absolute URL, or null.
function parseURL(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const ReleaseInfo = {
  // port of Updates.swift ReleaseInfo.parse
  /// Parses `GET /repos/{owner}/{repo}/releases/latest`. Picks the first asset whose name satisfies `assetMatches`
  /// (default: the Mac rule `ClaudeBuddy-*.zip`; the Windows updater passes its own).
  parse(json: string, assetMatches: (name: string) => boolean = isMacReleaseAsset): ReleaseInfo | null {
    const obj = parseJSONObject(json);
    if (obj === null) return null;
    const tag = obj["tag_name"];
    if (typeof tag !== "string") return null;
    const version = SemanticVersion.parse(tag);
    if (version === null) return null;
    if (obj["draft"] === true || obj["prerelease"] === true) return null;
    const assets = obj["assets"];
    // Swift `as? [[String: Any]]` fails if any element isn't an object.
    if (!Array.isArray(assets) || !assets.every(isObject)) return null;
    const zip = assets.find((a) => {
      const name = typeof a["name"] === "string" ? a["name"] : "";
      return assetMatches(name);
    });
    if (zip === undefined) return null;
    const urlString = zip["browser_download_url"];
    if (typeof urlString !== "string") return null;
    const url = parseURL(urlString);
    if (url === null || url.protocol !== "https:") return null;

    let sha256: string | undefined;
    const digest = zip["digest"];
    if (typeof digest === "string" && digest.startsWith("sha256:")) {
      sha256 = digest.slice("sha256:".length).toLowerCase();
    }
    const html = obj["html_url"];
    const pageURL = typeof html === "string" && parseURL(html) !== null ? html : undefined;
    const info: ReleaseInfo = { tag, version, zipURL: urlString };
    if (sha256 !== undefined) info.sha256 = sha256;
    if (pageURL !== undefined) info.pageURL = pageURL;
    return info;
  },
};
