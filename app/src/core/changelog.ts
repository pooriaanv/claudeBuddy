// Windows addition (Pooria, 2026-10-22): "What's new" after an update. Reads CHANGELOG.md (bundled at build time)
// into versions, picks the ones a user has not seen yet, and turns their notes into simple, safe HTML.

export interface ChangelogSection {
  version: string;
  date: string;
  /// The section's Markdown, without its heading.
  body: string;
}

/// `## 0.3.1 — 2026-10-21` headings, newest first (as in the file).
export function parseChangelog(md: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^## (\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.+))?$/.exec(line);
    if (h) {
      current = { version: h[1], date: (h[2] ?? "").trim(), body: "" };
      out.push(current);
    } else if (current !== null) {
      current.body += line + "\n";
    }
  }
  for (const s of out) s.body = s.body.trim();
  return out;
}

/// -1 / 0 / 1 for dotted numeric versions ("0.10.0" > "0.9.3").
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/// The sections a user updating from `seen` to `current` has not seen (newest first). `seen` null: just `current`.
export function unseenSections(sections: readonly ChangelogSection[], seen: string | null, current: string): ChangelogSection[] {
  return sections.filter(
    (s) =>
      compareVersions(s.version, current) <= 0 &&
      (seen === null ? compareVersions(s.version, current) === 0 : compareVersions(s.version, seen) > 0),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/// Inline Markdown we use in the changelog: **bold**, `code`, [text](url) (shown as its text - the window opens no
/// links). Everything is escaped first, so the notes can never inject markup.
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/// The changelog's Markdown subset - paragraphs and (nested) "- " lists, continuation lines indented - as HTML.
export function renderNotes(body: string): string {
  type Item = { depth: number; text: string };
  const blocks: ({ kind: "p"; text: string } | { kind: "list"; items: Item[] })[] = [];
  for (const raw of body.split("\n")) {
    if (raw.trim() === "") continue;
    const bullet = /^(\s*)[-*] (.*)$/.exec(raw);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      const item = { depth: Math.floor(bullet[1].length / 2), text: bullet[2] };
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (last?.kind === "list" && /^\s+/.test(raw)) {
      last.items[last.items.length - 1].text += " " + raw.trim(); // a wrapped line of the item above
    } else if (last?.kind === "p") {
      last.text += " " + raw.trim();
    } else {
      blocks.push({ kind: "p", text: raw.trim() });
    }
  }
  let html = "";
  for (const b of blocks) {
    if (b.kind === "p") {
      html += `<p>${inline(b.text)}</p>`;
      continue;
    }
    let depth = -1;
    for (const it of b.items) {
      while (depth < it.depth) {
        html += "<ul>";
        depth++;
      }
      while (depth > it.depth) {
        html += "</ul>";
        depth--;
      }
      html += `<li>${inline(it.text)}</li>`;
    }
    while (depth-- >= 0) html += "</ul>";
  }
  return html;
}
