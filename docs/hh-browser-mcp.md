# HH browser contracts MCP

This local MCP attaches Playwright to a dedicated Chrome instance over CDP. It
supports the interactive parts that Scrapling cannot inspect: Magritte dialogs,
the Chatik iframe/widget, form controls, and redacted fetch/XHR/WebSocket
contracts.

## Start

1. Run `npm run mcp:chrome`.
2. Sign in to HH in the opened Chrome window. The persistent browser profile is
   stored outside the repository at `~/.hh-orbit-cdp-profile`.
3. Restart Codex so it reloads `.codex/config.toml`.

The MCP server is started automatically by Codex as `hh_browser_contracts`.

## Tools

- `hh_pages`: list and select browser pages.
- `hh_navigate`: navigate to an HTTPS HH URL.
- `hh_snapshot`: inspect actual DOM in the main document and child frames.
- `hh_click`: click a CSS selector in the main document or a selected frame.
- `hh_fill`: fill a control without returning or logging its value.
- `hh_capture`: start/read/stop a redacted network and WebSocket contract log.

## Chat capture sequence

1. Clear and start `hh_capture`.
2. Open `/applicant/negotiations`.
3. Click `[data-qa="chatikActivator-button"]` or `[data-qa="open_chat"]`.
4. Snapshot `[role="dialog"], [data-qa*="chat"], textarea, input, button` in
   every frame.
5. Exercise non-destructive controls and read the captured contracts.
6. Stop capture.

Actual cookie, authorization, XSRF, token, contact, and message values are never
returned. Message-like fields and WebSocket frames are represented by length
and a short SHA-256 fingerprint so repeated events can still be correlated.

Do not close the dedicated Chrome window if the authenticated session must stay
available.
