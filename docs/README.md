# HH integration research

These artifacts record observed HH applicant contracts for implementation and
testing. They intentionally exclude cookies, XSRF values, access tokens,
account identifiers, message contents, and other personal data.

## Primary artifacts

| File | Purpose |
| --- | --- |
| `hh-live-contracts-2026-07-28.json` | Machine-readable routes, selectors, page states, modal flows, Chatik, and observed network contracts. |
| `hh-backend-contracts-2026-07-15.md` | Backend/preflight request and outcome notes. |
| `hh-contracts-2026-07-15.md` | Narrative page and interaction findings. |
| `hh-browser-mcp.md` | Local CDP browser-MCP setup and safe chat capture workflow. |
| `project-assessment-2026-07-15.md` | Earlier codebase assessment. |

## Use rules

- Treat all contracts as dated observations; re-capture before relying on a
  mutation endpoint.
- Use the JSON artifact for code-facing selectors and route matching.
- Keep irreversible actions behind explicit user confirmation.
- Do not add authentication material or raw chat/profile data to these files.
