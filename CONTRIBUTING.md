# Contributing to @keboola/n8n-nodes-keboola

Thanks for helping improve this package! 🎉  
This document explains how to set up the project, propose changes, and ship releases safely.

## Code of Conduct

By participating, you agree to uphold our community standards. The dedicated file is available at[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Project Overview

- **Package**: `@keboola/n8n-nodes-keboola`
- **Purpose**: n8n nodes to interact with Keboola Storage APIs & MCP Server
- **License**: MIT
- **Node**: `>= 20.15`
- **Repo layout (simplified)**:
```bash
.
├─ nodes/ # n8n node sources (TypeScript)
├─ credentials/ # n8n credential sources (TypeScript)
├─ dist/ # build output (generated)
├─ .changeset/ # changeset files (generated)
├─ .github/workflows/ # CI/CD
├─ package.json
├─ README.md
└─ CONTRIBUTING.md
```

## Getting Started

### Prerequisites
- Node.js **>= 20.15**
- npm (comes with Node)

### Install
```bash
npm ci

### Useful Scripts

```bash
npm run dev        # TypeScript watch build
npm run build      # clean dist + build + gulp icons
npm run lint       # lint sources
npm run lintfix    # lint with --fix
npm run changeset  # create a changeset (see Versioning)
```

> The package builds to `CommonJS` in dist/. Do not commit dist/; CI builds it.

## Contribution Workflow

We accept contributions from both **internal (Keboola)** and **external** contributors.

### Internal contributors (Keboola team)

1. Create a feature branch from `main`.
2. Make changes; keep commits focused.
3. If your change is user-visible (feature, fix, breaking change), **add a changeset**:
```bash
npm run changeset
```
4. Run `npm run lint` and `npm run build`.
5. Push and open a PR to `main`.

### External contributors (community)

1. `Fork` the repository to your GitHub account.
2. Create a branch from `main` in your fork.
3. Implement changes and `add a changeset` if user-visible:
```bash
npm run changeset
```
4. Run `npm run lint` and `npm run build`.
5. Push to your fork and open a PR against `main` of this repo.

> CI will run on your PR. Publishing to npm only occurs from `main` after maintainers merge the auto "Version Packages" PR (see Release process).

### Versioning, Changelog, and Releases (Changesets)

We use [Changesets](https://github.com/changesets/changesets) to control versions, changelogs, and publishing.

#### When to add a changeset

Add a changeset for any **user-visible** change:

- `fix:` bug fixes `→` patch
- `feat:` new features, backwards-compatible `→` **minor**
- breaking change → `major` (call out the break in the summary)

#### How to add a changeset

```bash
npm run changeset
# Select the package(s) (usually @keboola/n8n-nodes-keboola)
# Choose bump type: patch / minor / major
# Write a short description (will appear in CHANGELOG)
git add .changeset/*.md
git commit -m "chore: changeset for <short description>"
```

#### Release process (fully automated)

1. Merge PRs with changesets into `main`.
2. CI opens a **"Version Packages"** PR that:
- Bumps `package.json` version.
- Updates `CHANGELOG.md` with changesets.
3. Maintainers merge the **Version Packages** PR.
4. CI publishes to **npm** (`--access public --provenance`) and creates a **GitHub Release**.

> **Do not run** `npm publish` **manually**. Releases are created by GitHub Actions after the Version Packages PR is merged.

### Commit Style (recommended)

We encourage Conventional Commits style for clarity:

- `feat`: add UploadToKeboola node
- `fix`: handle expired token refresh
- `docs`: update README for setup
- `chore`: bump deps
- `refactor`: extract S3 utility

This improves PR history and makes changelogs easier to read.

### Coding Standards

- TypeScript throughout.
- Follow ESLint/Prettier rules:

```bash
npm run lint
npm run lintfix
```

- Keep nodes/credentials consistent with n8n community guidelines:
	- Put node implementations under `nodes/<Feature>/<Feature>.node.ts`.
	- Credentials under `credentials/<Name>.credentials.ts`.
	- Export entry points from `src/index.ts` (compiled to `dist/index.js`).
	
### Testing & Local Checks

- Ensure the project **builds** and **lints** before opening a PR:

```bash
npm run build && npm run lint
```

- If you add runtime behavior, include basic test coverage where possible (we may add a test runner later).

### Dependency Policy

- We keep transitive dependencies patched via **npm** `overrides` when needed (e.g., security advisories).
- If `npm audit` flags transitive issues, propose an **override** in `package.json` and verify with:

```bash
rm -rf node_modules package-lock.json
npm ci
npm ls <pkg-name>
npm audit
```

## Security

If you discover a vulnerability, **do not** open a public issue.
Email maintainers or open a private report if security reporting is enabled. We will coordinate a fix and release.

## PR Checklist	

- [ ] Feature/fix is scoped and documented.
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` passes (or `npm run lintfix` applied).
- [ ] Changeset added (if user-visible).
- [ ] Tests updated/added (if applicable).
- [ ] README or examples updated (if behavior changed).

## Questions?

Open a GitHub Issue or start a Discussion. We're happy to help you get your first PR merged!
