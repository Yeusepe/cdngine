# Language Style And Documentation

## 1. Style precedence

1. local repo docs and conventions
2. surrounding package precedent
3. Google TypeScript and JavaScript style guides
4. Google Markdown style guidance

## 2. Local rules

- TypeScript-first
- ES modules only
- named exports by default
- responsibility-based filenames
- no vague `helpers` or `misc` modules
- document constraints and reasoning, not obvious code
- keep docs portable and scrubbed of machine-local details

## 3. Naming guidance

Prefer names by responsibility:

- `register-service-namespace.ts`
- `derive-deterministic-key.ts`
- `validate-asset-upload.ts`

Avoid names by implementation trivia:

- `utils.ts`
- `manager2.ts`
- `data-handler.ts`

