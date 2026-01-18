# Custom Agents

**Parent:** [../AGENTS.md](../AGENTS.md)

## Purpose

Custom agent definitions for Claude Code. These agents provide specialized review and analysis capabilities beyond standard code review. They embody specific perspectives and expertise areas.

**Key concept:** Agents are **not** part of standard code reviews. They are invoked explicitly for deep-dive exploration when you need a particular mindset or expertise.

## Key Files

| File | Agent | Role |
|------|-------|------|
| `elrond-software-architect.md` | Elrond | Long-term architecture thinking |

## For AI Agents

### Available agents

#### Elrond — Software Architect

**File:** `elrond-software-architect.md`

**Mindset:** "Will this still make sense in 2 years? Can we change it later?"

**Expertise:**
- Long-term architecture decisions
- Service boundaries and interfaces
- Extensibility and future-proofing
- Technical debt prevention

**When to invoke:**
```
Ask Elrond about [architectural decision]
```

**Example invocations:**
- "Ask Elrond about splitting the auth service"
- "Elrond, is this API design MLS-ready?"
- "What does Elrond think of this module structure?"

**Focus areas:**
- Clean Architecture principles
- Dependency management
- Interface design for extensibility
- "Can we add MLS later without major refactor?"

### Character system (from CLAUDE.md)

These characters are defined in the root `CLAUDE.md` but may have detailed implementations here:

| Character | Mindset | Use For |
|-----------|---------|---------|
| Faramir | "How would I hack this?" | Security, threat modeling, auth flows |
| Elrond | "Will this work in 2 years?" | Architecture, long-term design, interfaces |
| Gandalf | "What happens at CPU-cycle level?" | Performance, profiling, latency analysis |
| Éowyn | "Will I understand this in 6 months?" | Code readability, maintainability, simplicity |
| Pippin | "Will my non-tech friends get it?" | UX, error messages, feature discoverability |

### Creating new agents

**1. Create agent file:**
```bash
.claude/agents/character-name-role.md
```

**2. Agent file structure:**
```markdown
# Character Name — Role

## Persona

[Character background and mindset]

## Expertise

- Area 1
- Area 2
- Area 3

## Approach

How this agent thinks about problems and what they prioritize.

## Example Questions

- Question type 1
- Question type 2

## Response Style

How the agent communicates (direct, detailed, visual, etc.)

## Scope

What this agent DOES review and what they DON'T.

## Common Patterns

Typical issues this agent identifies and how they suggest solving them.
```

**3. Document in CLAUDE.md:**
Add the character to the "Character Deep-Dives" section with invocation examples.

**4. Test the agent:**
```
Ask [Character] about [topic]
```

### Agent vs. Standard Review

**Standard Review (8 Concerns):**
- Security, Architecture, API Design, Performance, Reliability, Code Quality, Testing, Compliance
- Automated, consistent, comprehensive
- Use for: PRs, commits, module reviews

**Agent Deep-Dive:**
- Single perspective, deep exploration
- Interactive, conversational
- Use for: Design decisions, architectural debates, focused investigation

**Don't mix:** Agents are for exploration, not mechanical checks.

### Invocation patterns

**Good invocations:**
- "Ask Elrond if this interface supports future voice E2EE"
- "What would Faramir say about this authentication flow?"
- "Get Gandalf's thoughts on this allocation pattern"

**Bad invocations:**
- "Ask Elrond to review this PR" (use standard review instead)
- "What does Elrond think of everything?" (too broad)
- "Ask all characters about this file" (unfocused, wasteful)

### Response expectations

Agents should:
- Stay in character (mindset, priorities)
- Provide specific, actionable feedback
- Reference relevant standards (ARCHITECTURE.md, STANDARDS.md, etc.)
- Acknowledge uncertainty ("This depends on...")
- Give both positive and critical feedback

Agents should NOT:
- Cover all 8 concern areas (that's standard review)
- Contradict project standards without strong rationale
- Provide generic advice (be specific to the codebase)

### Agent maintenance

**Update agents when:**
- Project architecture evolves (update Elrond's context)
- New security patterns emerge (update Faramir's knowledge)
- Performance targets change (update Gandalf's benchmarks)

**Keep agents focused:**
- Each agent has distinct expertise
- Overlaps are OK but minimize redundancy
- Agents can reference each other ("Faramir would say...")

### Integration with CLAUDE.md

The `CLAUDE.md` file is the source of truth for:
- When to use which agent
- Character personalities and mindsets
- Invocation patterns

Agent files in this directory are:
- Detailed implementations
- Extended context and examples
- Character-specific knowledge bases

### Extending the agent system

**Add new character:**
1. Identify missing perspective (e.g., "Database Expert", "DevOps Guru")
2. Create agent file with clear scope
3. Document in CLAUDE.md Characters section
4. Test with real scenarios
5. Refine based on usefulness

**Deprecate character:**
1. Mark as deprecated in CLAUDE.md
2. Document why (overlap with other agent, no longer needed)
3. Keep file for historical reference

### Example agent interaction flow

```
Developer: "I'm designing the new permission system. Should we use RBAC or ABAC?"

Developer: "Ask Elrond about RBAC vs ABAC for the permission system"

Elrond (agent):
"Looking at your architecture in ARCHITECTURE.md and the long-term goals...

RBAC (Role-Based Access Control):
+ Simple model, easy to reason about
+ Your current guild/channel hierarchy fits naturally
+ Familiar to most developers
- Harder to express complex rules ("owner of this specific channel")
- Role explosion as features grow

ABAC (Attribute-Based Access Control):
+ Extremely flexible ("if user.id == channel.owner_id")
+ Scales with complexity
- Harder to audit ("who can access X?")
- Performance concerns with complex policies

Given your goals:
1. You want Discord-like simplicity (favors RBAC)
2. But you mentioned MLS drop-in later (might need ABAC flexibility)
3. Current scale: small guilds, not enterprise

Recommendation: **Start with RBAC, design for ABAC evolution**
- Use RBAC for guild/channel roles
- Keep permission checks behind interface: can_user_do(user, action, resource)
- Interface can evolve from role checks to attribute evaluation
- Gives you simplicity now, flexibility later

The key is: can you change the implementation without changing call sites? If yes, start simple."
```

### Anti-patterns

**Don't create agents for:**
- Language-specific syntax checks (use linter)
- Formatting enforcement (use rustfmt)
- Generic "be better" feedback (too vague)
- Checklist validation (use standard review)

**Don't invoke agents for:**
- Trivial changes (typo fixes, formatting)
- Quick yes/no questions (use documentation)
- Every single PR (save for complex decisions)

### Performance considerations

Agent invocations use LLM context:
- Invoke sparingly (expensive in tokens)
- Be specific in questions (focused context)
- Cache agent responses for similar questions
- Prefer standard review for routine checks

### Future enhancements

**Potential additions:**
- Database schema expert (migrations, indexes, queries)
- API design specialist (REST/WebSocket conventions)
- DevOps/infrastructure expert (deployment, scaling)
- Accessibility advocate (WCAG, screen readers, keyboard nav)

**Automation opportunities:**
- Auto-suggest which agent to invoke based on changed files
- Agent consensus ("3 agents agree this needs attention")
- Agent disagreement highlights (interesting architectural tension)

### Documentation

All agent definitions should:
- Be self-contained (explain role without external context)
- Include example invocations
- Specify scope clearly
- Reference project standards
- Remain in character

This allows both humans and AI to understand how to use each agent effectively.
