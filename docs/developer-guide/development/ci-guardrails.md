# CI Guardrails

This ruleset captures the recurring CI failure modes we have already hit and turns them into enforceable constraints.

## Why this exists

Recent CI incidents came from three classes of regressions:

- Windows Tauri/libvpx environment drift across workflows
- Non-deterministic setup integration tests due to shared state assumptions
- Permissive HTTP assertion patterns that hide behavior drift

These guardrails are designed to fail early in CI before those regressions land.

## Enforced rules

The script `scripts/check_ci_guardrails.py` is the source of truth for automated checks.

### 1) Windows libvpx setup must stay aligned in both workflows

Both `.github/workflows/ci.yml` and `.github/workflows/tauri-build.yml` must include:

- `vcpkg install libvpx:x64-windows-static-md`
- `choco install -y pkgconfiglite`
- `VPX_LIB_DIR`
- `VPX_INCLUDE_DIR`
- `VPX_VERSION=1.15.2`
- `VPX_STATIC=1`

And `ci.yml` must not reintroduce a `PKG_CONFIG=...pkg-config/pkgconf` workaround.

### 2) Setup integration tests must be DB-isolated and strict

`server/tests/integration/setup_integration.rs` must:

- Use `#[sqlx::test]` for all setup integration tests
- Not use `#[serial(setup)]`
- Not use `Config::default_for_test()` with shared DB assumptions
- Keep strict assertions for first-user sequencing:
  - `assert_eq!(user_count, 0, ...)`
  - `assert_eq!(user_count2, 1, ...)`
- Not early-return on non-zero initial user count

### 3) Attachment anti-enumeration behavior must stay explicit

`server/tests/integration/uploads_http.rs` must:

- Keep `test_get_attachment_anti_enumeration_parity`
- Keep strict `403` assertion for nonexistent attachment metadata access
- Avoid permissive `403 || 404` assertion pattern in this path

## Local usage

Run before pushing:

```bash
python3 scripts/check_ci_guardrails.py
```

## CI integration

The main CI workflow runs this script in the `Docs Governance` job. Any violation fails the job.

## Scope boundaries

These guardrails are intentionally narrow and incident-driven. Expand only when a new failure mode is repeated and can be encoded as a deterministic rule.
