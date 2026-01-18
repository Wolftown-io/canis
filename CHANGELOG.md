# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CHANGELOG.md following keepachangelog.com format
- Changelog maintenance guidelines in CLAUDE.md

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.1.0] - 2026-01-18

### Added
- Permission system with API handlers for admin, roles, and overrides
- Rate limiting middleware with Redis-based tracking and route integration
- Hierarchical AGENTS.md documentation for codebase navigation
- Git workflow design with commit conventions and worktree strategy
- Docker-based test infrastructure with proper database permissions
- Admin panel with two-tier privilege model (base admin + elevated admin)
- System audit logging for compliance and security tracing
- Global user bans and guild suspension capabilities
- System announcements feature

### Changed
- Hardened Docker infrastructure with Bitnami images
- Reworked persona system to concern-based code reviews
- Updated roadmap with Phase 3 status (rate limiting complete)

### Fixed
- File upload and download issues
- Merge conflict resolution from cherry-pick
- Dockerfile path reference in CI workflow
- MinIO image configuration (switched to official minio/minio)
- Bitnami images using :latest tag
- Secondary sort key for stable message ordering
- SQLx test fixtures with proper db permissions
- Code formatting and clippy warnings

[Unreleased]: https://github.com/Wolftown-io/canis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Wolftown-io/canis/releases/tag/v0.1.0
