# Project Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 12 findings from the full project audit (score >= 50), covering code health, documentation, and stale comments.

**Architecture:** Pure cleanup — no new features. Fix code patterns, consolidate plan docs, update stale comments and CHANGELOG.

**Tech Stack:** Rust, TypeScript, Markdown

---

### Task 1: Consolidate plan docs into single canonical directory

**Files:**
- Move: all 18 files from `docs/plans/` to `docs/developer-guide/plans/`
- Delete: `docs/plans/` directory (after moving)

**Step 1: Move all plan files**

```bash
# Move files that don't already exist in target
for f in docs/plans/*.md; do
  basename=$(basename "$f")
  if [ ! -f "docs/developer-guide/plans/$basename" ]; then
    mv "$f" "docs/developer-guide/plans/"
  else
    echo "CONFLICT: $basename exists in both — keeping developer-guide version"
    rm "$f"
  fi
done
rmdir docs/plans/ 2>/dev/null || rm -r docs/plans/
```

**Step 2: Verify no broken references**

```bash
grep -r "docs/plans/" --include="*.md" --include="*.ts" --include="*.rs" . | grep -v "docs/developer-guide/plans/" | grep -v node_modules | grep -v target
```

Fix any references found to point to `docs/developer-guide/plans/`.

**Step 3: Commit**

```
chore(docs): consolidate plan docs into developer-guide/plans
```

---

### Task 2: Strip Claude workflow annotations from plan docs

**Files:**
- Modify: all `docs/developer-guide/plans/*-plan.md` files containing "For Claude: REQUIRED SUB-SKILL"

**Step 1: Remove the annotation lines**

```bash
# Remove lines containing the workflow annotation
find docs/developer-guide/plans/ -name "*.md" -exec sed -i '/For Claude.*REQUIRED SUB-SKILL/d' {} \;
# Also remove empty blockquote lines left behind
find docs/developer-guide/plans/ -name "*.md" -exec sed -i '/^> *$/d' {} \;
```

**Step 2: Verify removal**

```bash
grep -r "REQUIRED SUB-SKILL" docs/developer-guide/plans/ | wc -l
# Expected: 0
```

**Step 3: Commit**

```
chore(docs): remove Claude workflow annotations from plan docs
```

---

### Task 3: Update CHANGELOG with recent entries and roadmap date

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Update roadmap date**

Change line 12 `Roadmap last updated: 2026-03-11` to `Roadmap last updated: 2026-03-14`.

**Step 2: Add missing Fixed entry for visual polish**

Under `### Fixed`, add:
```
- Improved contrast and visibility of admin badges, formatting toolbar, server rail, settings modal, and user panel across all 4 themes (#365)
```

Wait — this was already added in PR #365. Verify by reading CHANGELOG. If already present, skip.

**Step 3: Verify simulcast auto-switching is reflected**

The CHANGELOG simulcast entry should mention REMB auto-switching (updated in #367). Verify it reads correctly.

**Step 4: Commit**

```
docs(voice): update CHANGELOG roadmap date
```

---

### Task 4: Fix unchecked Instant subtraction in track.rs tests

**Files:**
- Modify: `server/src/voice/track.rs:743,749`

**Step 1: Fix the unchecked subtractions**

Line 743 — change:
```rust
sub.last_layer_change = Instant::now() - Duration::from_secs(1);
```
to:
```rust
sub.last_layer_change = Instant::now().checked_sub(Duration::from_secs(1)).unwrap();
```

Line 749 — change:
```rust
sub.last_layer_change = Instant::now() - Duration::from_secs(4);
```
to:
```rust
sub.last_layer_change = Instant::now().checked_sub(Duration::from_secs(4)).unwrap();
```

**Step 2: Verify tests pass**

```bash
SQLX_OFFLINE=true cargo test -p vc-server -- voice::track 2>&1 | tail -5
```

**Step 3: Commit**

```
fix(voice): use checked_sub for Instant arithmetic in tests
```

---

### Task 5: Fix unsafe unwrap in discovery handlers

**Files:**
- Modify: `server/src/discovery/handlers.rs:145,200`

**Step 1: Replace unwrap with safe pattern**

Line 145 — the current code is inside an `if has_search` block where `has_search` checks `query.q.is_some()`. Replace:
```rust
builder.push_bind(query.q.as_ref().unwrap().trim().to_string());
```
with:
```rust
if let Some(q) = query.q.as_ref() {
    builder.push_bind(q.trim().to_string());
}
```

Wait — this is inside an `if has_search` guard already, so the unwrap is logically safe. But we can still make it cleaner. Actually the simplest fix that preserves the same logic:

Change both lines 145 and 200 from:
```rust
builder.push_bind(query.q.as_ref().unwrap().trim().to_string());
```
to:
```rust
builder.push_bind(query.q.as_deref().unwrap_or_default().trim().to_string());
```

This eliminates the panic path even if the guard is removed in a future refactor.

**Step 2: Verify it compiles and tests pass**

```bash
SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings 2>&1 | tail -5
```

**Step 3: Commit**

```
fix(api): replace unsafe unwrap with unwrap_or_default in discovery
```

---

### Task 6: Replace unreachable! with Result in page queries

**Files:**
- Modify: `server/src/pages/queries.rs:618`

**Step 1: Read the surrounding code to understand the retry loop**

The `unreachable!()` is after a retry loop. Read lines 600-620 to understand the loop structure, then replace the `unreachable!` with a proper error return.

Change:
```rust
unreachable!("revision retry loop should always return before exhausting");
```
to:
```rust
Err(sqlx::Error::Protocol("revision retry loop exhausted".into()).into())
```

Or use the appropriate error type for the function's return type.

**Step 2: Verify it compiles**

```bash
SQLX_OFFLINE=true cargo check -p vc-server 2>&1 | tail -5
```

**Step 3: Commit**

```
fix(api): replace unreachable! with error return in page revision loop
```

---

### Task 7: Update stale MFA TODO in admin elevation

**Files:**
- Modify: `server/src/admin/handlers.rs:688`

**Step 1: Update the comment**

Change:
```rust
// TODO: Re-add MFA verification here once the MFA enrollment flow is implemented.
```
to:
```rust
// NOTE: MFA verification for admin elevation is deferred. The MFA enrollment
// flow exists but admin elevation currently relies on password-only verification.
// See: docs/developer-guide/plans/ for the admin MFA integration plan.
```

**Step 2: Commit**

```
fix(auth): clarify admin elevation MFA status comment
```

---

### Task 8: Update stale scroll-to-message TODO

**Files:**
- Modify: `client/src/views/Main.tsx:273`

**Step 1: Update the comment**

Change:
```typescript
// TODO: Implement scroll-to-message in a follow-up PR
```
to:
```typescript
// Scroll-to-message works for search results; pin drawer dismisses on jump for now
```

**Step 2: Commit**

```
fix(client): update stale scroll-to-message TODO
```

---

### Task 9: Clarify DM voice call capability comments

**Files:**
- Modify: `server/src/voice/call.rs:8,18,24,26`

**Step 1: Update module and struct comments**

Line 8 — change:
```rust
//! - Call capabilities for future extensibility (video, screen share)
```
to:
```rust
//! - Call capabilities (audio-only for DM calls; guild channels support video/screenshare separately)
```

Line 18 — change:
```rust
/// This struct allows future extensibility for video calls and screen sharing
```
to:
```rust
/// DM calls are currently audio-only. Video and screen sharing are supported
/// in guild voice channels via the SFU (see voice/sfu.rs), not via DM calls.
```

Lines 24-26 — change:
```rust
    /// Video capability (future: video calls)
    pub video: bool,
    /// Screen share capability (future: screen sharing)
```
to:
```rust
    /// Video capability (reserved for future DM video calls)
    pub video: bool,
    /// Screen share capability (reserved for future DM screen sharing)
```

**Step 2: Commit**

```
fix(voice): clarify DM call capability comments
```

---

### Task 10: Update plan lifecycle documentation

**Files:**
- Modify: `docs/developer-guide/plans/PLAN_LIFECYCLE.md` (or `docs/plans/PLAN_LIFECYCLE.md` if not yet moved)

**Step 1: Add status entries for completed plans**

Read the file, then append entries for major completed plans. At minimum, mark the simulcast plans as implemented:

```markdown
## Implemented Plans

| Plan | Status | Implemented In |
|------|--------|---------------|
| 2026-03-11-simulcast-design.md | Implemented | #361 |
| 2026-03-11-simulcast-implementation.md | Implemented | #361 |
| 2026-03-14-simulcast-auto-switching-design.md | Implemented | #367 |
| 2026-03-14-simulcast-auto-switching-plan.md | Implemented | #367 |
| 2026-03-14-frontend-visual-polish-design.md | Implemented | #365 |
| 2026-03-14-frontend-visual-polish-plan.md | Implemented | #365 |
```

**Step 2: Commit**

```
docs: update plan lifecycle with implemented plans
```

---

### Task 11: Final verification

**Step 1: Run server checks**

```bash
cargo fmt --check -p vc-server
SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings
SQLX_OFFLINE=true cargo test -p vc-server -- voice 2>&1 | grep "test result"
```

**Step 2: Run client checks**

```bash
cd client && bun run test:run
```

**Step 3: Verify no remaining issues**

```bash
grep -r "docs/plans/" --include="*.md" . | grep -v "docs/developer-guide/plans/" | grep -v node_modules | grep -v target | grep -v CHANGELOG
```

Expected: no results (all references point to canonical path).
