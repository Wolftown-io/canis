# Plan Lifecycle Registry

Canonical lifecycle registry for superseded/active plan relationships.

## Lifecycle States

- **Active**: Current canonical document for a topic.
- **Superseded**: Replaced by a newer canonical document.
- **Archived**: Historical document that is neither current nor an active supersession source.

## Supersession Map

| Plan | Lifecycle | Superseded By | Notes |
|------|-----------|---------------|-------|
| `PHASE_5_IMPLEMENTATION.md` | Superseded | `PHASE_5_SONNET_IMPLEMENTATION.md` | Older phase-level implementation manual replaced by Sonnet-focused version |
| `PHASE_5_SONNET_IMPLEMENTATION.md` | Active | - | Current canonical Phase 5 implementation manual |
| `2026-01-29-moderation-safety-implementation.md` | Superseded | `2026-01-29-moderation-safety-implementation-v2.md` | v2 includes corrected sequencing and expanded safeguards |
| `2026-01-29-moderation-safety-implementation-v2.md` | Active | - | Current canonical moderation and safety implementation plan |

## Implemented Plans

| Plan | Implemented In | Date |
|------|---------------|------|
| `2026-03-11-simulcast-design.md` | #361 | 2026-03-11 |
| `2026-03-11-simulcast-implementation.md` | #361 | 2026-03-11 |
| `2026-03-14-simulcast-auto-switching-design.md` | #367 | 2026-03-14 |
| `2026-03-14-simulcast-auto-switching-plan.md` | #367 | 2026-03-14 |
| `2026-03-14-frontend-visual-polish-design.md` | #365 | 2026-03-14 |
| `2026-03-14-frontend-visual-polish-plan.md` | #365 | 2026-03-14 |
| `2026-03-14-project-audit-fixes-plan.md` | #368+ | 2026-03-14 |

## Maintenance Rules

When a plan is replaced:

1. Add `**Lifecycle:** Superseded` and `**Superseded By:**` to the old plan.
2. Add `**Lifecycle:** Active` and `**Supersedes:**` to the new plan.
3. Update this registry table in the same change.
4. Run `python3 scripts/check_docs_governance.py`.
