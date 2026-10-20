# Progress log

One row per phase. Updated when a phase merges.

| Phase | Status | Date       | PR / description         | Decisions                                                                                                                                                                                                                             | Deferred                                                                                                |
| ----- | ------ | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 3     | Done   | 2026-10-21 | [phase-3.md](phase-3.md) | Applications and API keys in ingest-service; baseline migration reset; unused web components deleted (restore from `v0-distribution`)                                                                                                 | Cross-tenant tests for ingest tables (Phase 4)                                                          |
| 4     | Done   | 2026-10-21 | [phase-4.md](phase-4.md) | Event types shared per organization; archive/revoke instead of delete; envelope-encrypted signing secrets with audited reveal; SHA-256 API key digests with a SECURITY DEFINER lookup; URL policy with a dev-only private-target flag | API key HTTP guard and rate limits (Phase 5); secret rotation (Phase 7); send-time SSRF check (Phase 6) |

## Notes

- Pull requests are described in `docs/phases/phase-N.md` when the GitHub CLI is not
  authenticated. The branch for each phase is `phase-N/<name>`, merged into
  `pivot/webhook-platform`.
