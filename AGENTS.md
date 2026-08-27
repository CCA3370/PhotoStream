# Repository Guidelines

- 在一次任务中，每个阶段完成时要提交一次（如追踪有变动），写好提交信息；所有阶段完成后，push一次
- 按文档完成代码实现后，要根据文档要求复查代码实现是否符合要求，是否为最优实现（优先级高于符合文档要求）

## Project Structure & Module Organization

This pnpm monorepo keeps the Next.js application in `apps/web`, the Fastify control-plane API in `apps/api`, shared Zod contracts in `packages/contracts`, and Drizzle schema/migrations in `packages/db`. Numbered specifications remain under `docs/`; read Accepted decisions in `docs/adr/` before changing system boundaries. Stage evidence belongs in `docs/verification/`.

## Build, Test, and Development Commands

Use Node.js 24 and pnpm 11:

- `pnpm install --frozen-lockfile` installs the exact dependency graph.
- `docker compose -f compose.dev.yml up -d postgres` starts local PostgreSQL 18.6.
- `pnpm --filter @photostream/db db:migrate` migrates the local database.
- `pnpm dev` starts Web and API; `pnpm check` runs lint, types, tests, and builds.
- `pnpm --filter @photostream/web storybook:build` validates component stories.
- `pnpm --filter @photostream/web test:e2e` runs Playwright/axe when a browser is available.

Cloud smoke, device testing, and deployment commands are not implied by local checks.

## Coding Style & Naming Conventions

TypeScript is strict and formatted/linted by Biome. Keep public contracts in `packages/contracts`; Next.js must call Fastify rather than PostgreSQL or a duplicate Server Action API. Use direct imports, serializable RSC props, semantic tokens, and system fonts. In `apps/web`, follow its generated `AGENTS.md`, ADR-010, and the shadcn `info → search/docs → dry-run/view → add → inspect` flow. Product copy is Simplified Chinese; identifiers and protocols stay exact.

## Testing Guidelines

Test from pure logic through API contracts and real local PostgreSQL, then browser/axe. Keep deterministic fixtures free of real student media, numbers, credentials, and signed URLs. Review `docs/10-test-and-acceptance.md`; record commands, exits, and environments. Never upgrade missing device, cloud, campus-network, or assistive-technology evidence beyond **Unverified**.

## Commit & Pull Request Guidelines

Use a short imperative subject with a useful scope, for example `feat(api): establish local authentication`. Pull requests should summarize behavior, affected contracts, verification, ADR/privacy implications, and remaining manual checks.

## Security & Scope Guardrails

Coding is authorized locally; deployment is not. Never commit credentials, real album passwords, student media/OCR samples, or signed URLs. Media bodies must not pass through Web/API/PostgreSQL. Do not create or change OSS, CDN, DNS, cloud, CI publication, or production resources without separate authorization. Changing an Accepted ADR requires an explicit replacement or amendment and synchronized documentation.
