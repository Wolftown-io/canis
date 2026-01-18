<!-- Parent: ../AGENTS.md -->
# Documentation

## Purpose
Project documentation, design plans, and technical references beyond the specifications in `specs/`.

## Key Files
- `rate-limiting.md` - Rate limiting implementation details

## Subdirectories
- `plans/` - Design and implementation plans

## For AI Agents

### Document Types
| Location | Purpose |
|----------|---------|
| `docs/plans/` | Implementation plans, design decisions |
| `docs/*.md` | Technical deep-dives on specific topics |
| `specs/` | Formal specifications (architecture, standards) |
| Root `*.md` | Quick start, readme, contributing |

### When to Update
- Creating design documents for new features → `docs/plans/`
- Documenting implementation details → `docs/`
- Updating specifications → `specs/`

### Documentation Standards
- Use CommonMark markdown
- Include diagrams where helpful (Mermaid preferred)
- Reference related code files with paths
- Keep design docs up-to-date as implementation evolves
