# create-ionify

Scaffold a new Ionify project (Basic/Dashboard templates, optional monorepo, testing presets, and smart defaults).

## Usage

```bash
npm create ionify@latest
```

Or directly:

```bash
npx create-ionify@latest
```

## Notes

- This package is intentionally dependency-light and uses Node built-ins for prompts and file generation.
- Interactive prompts support arrow-key navigation (Up/Down) with defaults clearly marked.
- It generates projects that run `ionify dev` by default.

## Release

The engine and scaffolder are separate npm package identities. From the private
engine repository, `pnpm build:create` produces the public release payload at
`dist/create-ionify/`. Publish that directory independently:

```bash
cd dist/create-ionify
npm publish
```
