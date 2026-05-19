# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-05-19

Initial release under the `vcon-dev` organization. Ported from the
pre-release `howethomas/vcon-mcp-adapter` working tree and renamed to
`vcon-mcp-proxy` to disambiguate from `vcon-mcp` (the MCP server for
managing vCons) and `vcon-mcp-adapters` (offline framework-trace
converters). This package is the live wire-tap proxy: it sits inline
between an MCP client and server, captures the session, and posts a
vCon to a conserver.

### Added

- `VconMcpProxy` class that wraps any MCP `Transport` via
  `wrapTransport(transport, sessionId?)`.
- `SessionManager`, `Session`, `VconBuilder`, and `ConserverClient`
  components, usable independently for custom integrations.
- IETF vCon core-02 (syntax `0.4.0`) output, including spec-compliant
  `attachments[]` for session tags (`purpose: "tags"`, `party: 0`,
  `dialog: 0`).
- `session_summary` analysis entry with `vendor` + `product` per spec.
- Event stream: `session:start`, `session:end`, `vcon:created`,
  `vcon:posted`, `vcon:error`.
- Reference implementation for
  [`draft-howe-vcon-mcp-session`](https://github.com/vcon-dev/draft-howe-vcon-mcp-session).

### Fixed (during port, vs. the howethomas source)

- vCon syntax field hardcoded to `"0.0.1"` → corrected to `"0.4.0"`.
- Tags emitted as a top-level `tags: {}` object → moved into
  `attachments[]` with `purpose: "tags"` per vCon core-02.
- `VconAttachment` interface required legacy `type` field and made
  `party`/`dialog` optional → `purpose` is now required and replaces
  `type`; `party` and `dialog` are required indices.
- Removed documentation of a "Standalone Proxy Mode" API
  (`targetCommand`/`targetArgs`/`proxy.start()`) that never existed on
  the class.

[Unreleased]: https://github.com/vcon-dev/vcon-mcp-proxy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vcon-dev/vcon-mcp-proxy/releases/tag/v0.1.0
