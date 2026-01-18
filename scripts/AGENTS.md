<!-- Parent: ../AGENTS.md -->
# Scripts

## Purpose
Build, development, and utility scripts for the project.

## Key Files
- `dev-setup.sh` - Complete development environment setup
- `create-test-users.sh` - Create test users in development
- `resume-session.sh` - Resume development session state
- `update-deps.sh` - Update and audit dependencies

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

#### Update Dependencies
```bash
./scripts/update-deps.sh
# Updates Rust and npm dependencies with license check
```

### Script Standards
- All scripts should be POSIX-compatible where possible
- Use `set -e` for error handling
- Include usage/help text
- Document prerequisites at the top

### When to Add Scripts
- Automating multi-step processes
- Development environment tasks
- CI/CD helpers
- One-time setup tasks

Avoid scripts for:
- Simple single commands (use Makefile instead)
- Platform-specific tasks (document alternatives)
