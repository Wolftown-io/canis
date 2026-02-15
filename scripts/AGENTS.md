<!-- Parent: ../AGENTS.md -->
# Scripts

## Purpose
Build, development, and utility scripts for the project.

## Key Files
- `dev-setup.sh` - Complete development environment setup
- `create-test-users.sh` - Create test users in development
- `check_docs_governance.py` - Validates roadmap/changelog/lifecycle consistency
- `generate_release_notes.py` - Builds standardized milestone release notes

## For AI Agents

### Script Usage

#### Initial Setup
```bash
./scripts/dev-setup.sh
# Sets up: Docker services, database migrations, test data
```

#### Create Test Users
```bash
./scripts/create-test-users.sh
# Creates: admin/admin123, alice/password123, bob/password123
```

### Script Standards
- All scripts should be POSIX-compatible where possible
- Use `set -e` for error handling
- Include usage/help text
- Document prerequisites at the top
- Keep scripts deterministic and CI-safe

### When to Add Scripts
- Automating multi-step processes
- Development environment tasks
- CI/CD helpers
- One-time setup tasks

Avoid scripts for:
- Simple single commands (use Makefile instead)
- Platform-specific tasks (document alternatives)
