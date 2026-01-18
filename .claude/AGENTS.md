<!-- Parent: ../AGENTS.md -->
# Claude Configuration

## Purpose
Claude Code configuration files and custom agent definitions.

## Key Files
- `settings.local.json` - Local Claude Code settings (gitignored patterns may apply)

## Subdirectories
- `agents/` - Custom agent definitions

## For AI Agents

### Custom Agents
The `agents/` directory contains specialized agent configurations:
- `elrond-software-architect.md` - Architecture review agent (see CLAUDE.md Characters section)

### Settings
`settings.local.json` contains project-specific Claude Code settings.

### CLAUDE.md Integration
The root `CLAUDE.md` file is the primary instruction source for AI agents. It contains:
- Code review system with 8 concern areas
- Character deep-dives (Faramir, Elrond, Gandalf, Éowyn, Pippin)
- Workflow guidelines
- Git workflow conventions

### Referencing
When you need:
- Security review → Ask Faramir (skeptical attacker mindset)
- Architecture review → Ask Elrond (long-term thinking)
- Performance analysis → Ask Gandalf (CPU-cycle obsessive)
- Code readability → Ask Éowyn (6-month maintainability test)
- UX sanity check → Ask Pippin (non-technical user perspective)
