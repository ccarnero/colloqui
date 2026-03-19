# sdd-explore Templates

Use these templates to keep exploration outputs consistent and concise.

## 1) Decision Matrix (for materially different options)

Use when there are 2+ options with meaningful trade-offs.

Scoring rule (single source of truth):
- favorable = `3 x weight`
- neutral = `2 x weight`
- unfavorable = `1 x weight`

```markdown
### Decision Matrix

| Criteria (Weight) | Option A | Option B | Option C |
|-------------------|----------|----------|----------|
| Complexity (3) | Favorable → 9 | Neutral → 6 | Unfavorable → 3 |
| Risk (3) | Favorable → 9 | Neutral → 6 | Favorable → 9 |
| Maintainability (2) | Favorable → 6 | Neutral → 4 | Favorable → 6 |
| Performance (1) | Neutral → 2 | Favorable → 3 | Favorable → 3 |
| **Total** | **26** | **19** | **21** |
```

## 2) Pros/Cons Table (for low-impact decisions)

Use when differences are minor and a weighted matrix would be overkill.

```markdown
### Approach Comparison

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| Option A | ... | ... | S / M / L / XL |
| Option B | ... | ... | S / M / L / XL |
```

## 3) Structured Return Envelope (required)

Use this exact structure for orchestrator responses.

```markdown
## Exploration: {topic}

### Current State
{How the system works today relevant to this topic}

### Affected Areas
- `path/to/file.ext` — {why it's affected}
- `path/to/other.ext` — {why it's affected}

### Approaches
1. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

2. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

### Recommendation
{Recommended approach and why. Reference decision matrix totals when used.}

### Complexity Estimate
- **Scope**: {XS / S / M / L / XL}
- **Files affected**: {estimated count}
- **Risk level**: {Low / Medium / High}
- **Suggested SDD depth**: {full pipeline vs. fast-track}

> If XS-S scope with Low risk, suggest fast-track: proposal → tasks → apply (skip specs/design).
> If M+ scope or Medium+ risk, recommend full SDD pipeline.

### Risks
- {Risk 1}
- {Risk 2}

### Ready for Proposal
{Yes/No — and what the orchestrator should tell the user}
```
