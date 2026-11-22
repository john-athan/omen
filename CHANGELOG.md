# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic
versioning while pre-1.0 (breaking changes may land in minor releases).

## [Unreleased]

### Changed
- Compatibility date 2026-10-01, deploys through the pinned wrangler, and `workers_dev` and `preview_urls` set explicitly (workers.dev on, preview addresses off)

### Fixed
- The delivered page now carries its Content-Security-Policy on `/delivered`, the path Cloudflare serves it on after redirecting `/delivered.html`

## [0.1.0] - 2026-11-22

### Added
- The village: every villager is someone's own local language model, and the player is only the voice in its head
- A README with screenshots and a social preview, `tools/validate.sh` and CI

### Security
- OParl is fetched only from known council servers, and the record page links only to web addresses
- wllama is vendored with checked hashes instead of loaded from a CDN
