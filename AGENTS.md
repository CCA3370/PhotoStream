# Repository Guidelines

- 在一次任务中，每个阶段完成时要提交一次（如追踪有变动），写好提交信息；所有阶段完成后，push一次
- 按文档完成代码实现后，要根据文档要求复查代码实现是否符合要求，是否为最优实现（优先级高于符合文档要求）

## Project Structure & Module Organization

This repository is currently a documentation baseline; it has no application source, dependency manifest, automated tests, or deployable assets. `README.md` summarizes the product, current constraints, and document index. Numbered specifications live in `docs/01-product-requirements.md` through `docs/12-bib-recognition.md`. Deployment inputs and external references are in `docs/deployment-inputs.md` and `docs/references.md`. Accepted architectural decisions live under `docs/adr/`; read these before proposing changes to system boundaries.

## Build, Test, and Development Commands

There is no build or runtime command during phase 0. Use lightweight repository checks instead:

- `rg --files` inventories the current Markdown-only tree.
- `git diff --check` catches trailing whitespace and malformed patch spacing.
- `rg -n '^#{1,3} ' README.md docs AGENTS.md` reviews heading hierarchy.
- `git diff -- README.md docs AGENTS.md` performs the final content review.

Do not describe future commands from the roadmap as presently runnable.

## Coding Style & Naming Conventions

Write UTF-8 Markdown with one H1 per file, descriptive numbered H2 sections in specifications, blank lines around headings and lists, and fenced code blocks for multi-line examples. Match the existing Simplified Chinese prose in product documentation; keep code identifiers, protocols, and command names exact and wrapped in backticks. Use two-digit numeric prefixes for top-level specifications (`03-domain-and-api-design.md`) and three-digit ADR numbers (`adr/009-short-decision-name.md`). Preserve established terms such as OSS, CDN, SSE, WebP, and WebCodecs.

## Testing Guidelines

For documentation changes, verify links, terminology, state transitions, paths, limits, and requirements across all affected files. Review `docs/10-test-and-acceptance.md` for the planned verification layers, but do not claim those tests have run. No coverage threshold or test framework exists yet. Record any unperformed device, browser, or cloud check as **Unverified**.

## Commit & Pull Request Guidelines

History currently contains only `Initial Commit`, so no established commit convention exists. Use a short imperative subject with a useful scope, for example `docs: clarify OSS upload constraints`. Pull requests should summarize the decision or correction, list affected documents, link an issue when available, and call out ADR or privacy implications. Include screenshots only for rendered visual changes.

## Security & Scope Guardrails

Phase 0 permits documentation work only. Do not add source directories, `package.json`, migrations, containers, CI, environment files, or cloud resources without explicit authorization. Never commit credentials or real deployment secrets. Changing an Accepted ADR requires an explicit replacement or amendment and corresponding updates to dependent documents.
