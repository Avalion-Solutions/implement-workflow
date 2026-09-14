# Agent workflow repository instructions

## Canonical source and generated package

- Treat `.agents/skills/` and `platforms/codex/` as canonical.
- Treat `plugins/basics/` as generated. After canonical changes, regenerate it with `node scripts/sync-codex-basics.mjs`, then require `node scripts/sync-codex-basics.mjs --check` to pass.
- Treat `product.json` as the canonical Basics product-generation version. Product releases and host adapters have independent semantic-version streams.
- Preserve a single version in `platforms/codex/plugin.json` and `plugins/basics/.codex-plugin/plugin.json`.
- Format adapter versions as `<semver>+<adapter>.<YYYYMMDDHHMMSS>`, using `codex` or `claude` as the adapter identifier.
- Increment only the version streams whose versioned content changes. Shared canonical-skill changes affect every generated adapter; adapter-specific changes affect only that adapter. Product-only release metadata does not force an unchanged adapter version to advance.
- Every Codex package change that will be committed, pushed, published, or installed must increment the Codex semantic version by at least one patch level and replace its cachebuster. A new cachebuster with an unchanged semantic version is not a version increment. Apply this to policy, documentation, skill, script, hook, metadata, packaging, and generated-package changes that affect the Codex deliverable.
- Apply the same rule independently to changed Claude adapter content, using a Claude semantic increment and a fresh `+claude.<cachebuster>` suffix.
- Never commit, push, publish, or install changed versioned content while its relevant semantic version still matches the pre-change commit. Regenerate generated adapters after canonical changes and verify every canonical/generated or manifest/marketplace version pair agrees.

## Mandatory hook refresh for Codex updates

Every Basics plugin install, reinstall, version bump, or cachebuster refresh must update the installed hooks. Do not finish the update with a bare `codex plugin add` because `hooks/hooks.json` contains `$PLUGIN_ROOT` and `%PLUGIN_ROOT%` templates that must be materialized for the installed destination.

After package validation and before reporting the update complete, run:

```bash
node plugins/basics/scripts/install-plugin.mjs install --marketplace personal
```

Use the actual marketplace name when it is not `personal`. The installer must invoke Codex installation, obtain the absolute installed destination, and materialize every root hook against that destination.

Then verify all of the following:

```bash
node --test plugins/basics/scripts/install-plugin.test.mjs
codex plugin list
```

- The installer exits successfully and reports the expected plugin version and absolute installed destination.
- The installed `hooks/hooks.json` contains no `$PLUGIN_ROOT` or `%PLUGIN_ROOT%` token.
- Every installed hook command points to an existing `skills/build/scripts/build-status.mjs` under that same installed destination.
- `codex plugin list` reports the expected enabled version.

Treat an unmaterialized, stale, missing, or mismatched hook destination as a failed plugin update. Repair it before committing the completion claim, and tell the user to start a new Codex thread after successful installation.

## Skill validation targets

- Run the bundled Node quick validator and non-strict checker against canonical `.agents/skills/<skill>` sources.
- Run the bundled checker with `--strict` against generated `plugins/basics/skills/<skill>` directories, where Codex `agents/openai.yaml` metadata has been injected.
- Invoke `.agents/skills/skill-check/scripts/check-skill.mjs` or `plugins/basics/skills/skill-check/scripts/check-skill.mjs`; never invoke a different global checker copy.
- Run the Node skill-check regression test whenever checker behavior changes.

## Release checks

Before commit and push, run the workflow tests, suite lint, checker regression tests, dashboard tests/build, plugin validation, canonical skill checks, packaged strict skill checks, generated-package drift check, and `git diff --check`. Commit only the intended plugin update files.
