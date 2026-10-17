# Changelog

Every release's notes on GitHub come from its section here (`## <version> — <date>`), so add one before tagging.

## 0.1.4 — 2026-10-17

- Bunny: a pink headband with a bow, and a smaller, softer mouth.
- The debug log now records which agent hook fired (event, session, turn, tool, app) - attach it to a bug report
  when the buddy knocks for nothing.

## 0.1.3 — 2026-10-16

- New character: **Byte**, a blocky little coder in Claude's colors. Now and then it pulls out a laptop, holds it
  in one hand and types with the other.
- MIT license.

## 0.1.2 — 2026-10-16

- Drop the buddy on an app and it stays in front of all apps, even when you click them (before, it slipped
  behind as soon as that app was clicked). Drop it on the desktop or the taskbar and it goes back behind your windows.
- The ninjas don't dance anymore; they train instead.
- New app icon: a knock on the glass.

## 0.1.1 — 2026-10-15

- Ninja moves are longer and choreographed like real martial-arts forms: strikes snap out, hold for a beat and
  return smoothly.
  - Kata: a 6 s form.
  - Kick: 2.8 s.
  - Shuriken: two throws, 2.8 s.
  - Sword: 5.2 s.

## 0.1.0 — 2026-10-15

First Windows release. It is a port of [ClaudeBuddy for macOS](https://github.com/pooriaanv/claudBuddy-Mac) 0.0.9.

- **Knocks when your agent needs you.** When Claude Code or Codex finishes a turn or asks for permission, the buddy
  comes up to the glass and knocks. Each character has its own knock sound. The bubble shows the project, and several
  sessions at once are queued.
- **Knock style.** Big in the middle of the screen, or right where it is (same spot, in front of every window).
- **Seven characters:** Buddy, Kitty, Puppy, Bunny, Robo, Ninja, Cyber Ninja.
  - They sit, walk, dance, nap and follow your cursor.
  - Click for hearts.
  - Drag and drop: the buddy falls back to the taskbar, or stays in front of the app you dropped it on until you use
    that app.
- **New moves.** Every character meditates now and then. The ninjas practice kata, kicks, shuriken and the sword.
- **Quiet mode** (optional): when you're already looking at the Claude/Codex desktop app, the buddy shows a small
  `✓ project` tag instead of knocking.
- **One-click agent hooks** for Claude Code and Codex.
  - Only the buddy's entries are added, a backup is kept, and your other hooks are untouched.
  - Any CLI can knock through `~/.claude-buddy/buddy-notify.exe`.
- **Settings:** size, mischief level, sound, open at login, English / فارسی.
- **Install.** Per-user install, no admin needed, and it updates itself.
