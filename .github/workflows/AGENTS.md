<!-- Parent: ../../AGENTS.md -->
# GitHub Actions Workflows

## Purpose

CI/CD pipeline definitions for the VoiceChat project. Handles automated testing, building, security scanning, and releases.

## Key Files

| File | Purpose |
|------|---------|
| `ci.yml` | Main CI pipeline: test, lint, build on every push/PR |
| `release.yml` | Release automation: builds, packages, and publishes releases |
| `security.yml` | Security scanning: dependency audits, SAST analysis |
| `tauri-build.yml` | Tauri client builds for all platforms |

### Documentation Files

| File | Purpose |
|------|---------|
| `PRIORITY_2_IMPROVEMENTS.md` | Planned CI/CD improvements |
| `RELEASE_WORKFLOW_FIX.md` | Release workflow troubleshooting guide |

## For AI Agents

### Workflow Triggers

**`ci.yml`** - Runs on:
- Push to `main` branch
- All pull requests
- Manual trigger

**`release.yml`** - Runs on:
- Tag push (`v*`)
- Manual trigger with version input

**`security.yml`** - Runs on:
- Schedule (weekly)
- Push to `main`
- Manual trigger

**`tauri-build.yml`** - Runs on:
- Release workflow completion
- Manual trigger

### CI Pipeline (`ci.yml`)

Jobs:
1. **lint** - `cargo fmt --check`, `cargo clippy`
2. **test-server** - `cargo test -p vc-server`
3. **test-shared** - `cargo test -p vc-common -p vc-crypto`
4. **test-client** - `bun run test:run` (frontend unit tests, vitest)
5. **build** - Verify compilation succeeds

### Release Pipeline (`release.yml`)

1. Validate version tag
2. Run full test suite
3. Build server Docker image
4. Build Tauri clients (via `tauri-build.yml`)
5. Create GitHub release
6. Upload artifacts

### Security Pipeline (`security.yml`)

1. `cargo audit` - Check for vulnerable dependencies
2. `cargo deny` - License compliance check
3. SAST scanning (if configured)

### Tauri Build (`tauri-build.yml`)

Matrix build for:
- Linux (x86_64) - AppImage
- macOS (x86_64, aarch64) - DMG
- Windows (x86_64) - MSI/EXE

### Adding New Workflows

```yaml
name: New Workflow

on:
  push:
    branches: [main]
  pull_request:

jobs:
  job-name:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Run task
        run: cargo test
```

### Secrets Required

| Secret | Purpose |
|--------|---------|
| `GITHUB_TOKEN` | Automatic (for releases) |
| `CARGO_REGISTRY_TOKEN` | (if publishing crates) |

### Common Issues

**Build failures:**
- Check `Cargo.lock` is committed
- Verify `sqlx` offline mode data is current
- Check for platform-specific issues in matrix builds

**Release failures:**
- Verify tag matches version in `Cargo.toml`
- Check signing certificates (macOS/Windows)
- Validate artifact paths

### Local Testing

```bash
# Install act for local workflow testing
brew install act  # macOS

# Run CI workflow locally
act push -j lint

# Run with secrets
act push --secret-file .secrets
```

## Dependencies

- GitHub Actions runners (ubuntu-latest, macos-latest, windows-latest)
- Docker for containerized builds
- Platform-specific toolchains for Tauri builds
