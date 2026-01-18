<!-- Parent: ../AGENTS.md -->
# GitHub Configuration

## Purpose

GitHub-specific configuration for the VoiceChat repository. Contains CI/CD workflows, issue templates, and repository settings.

## Subdirectories

- `workflows/` - GitHub Actions CI/CD pipelines - see workflows/AGENTS.md

## For AI Agents

### Adding New Workflows

New workflows should be placed in `workflows/` directory. See `workflows/AGENTS.md` for:
- Workflow templates
- Required secrets
- Trigger patterns
- Common issues

### Repository Configuration

GitHub repository settings (branch protection, merge rules) are managed via GitHub UI, not files in this directory.

## Dependencies

- GitHub Actions runners
- Repository secrets (see workflows/AGENTS.md)
