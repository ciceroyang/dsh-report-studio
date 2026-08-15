# Zero to published: writing your first DeepSeek Harness plugin (with every pitfall)

> A field report from building [dsh-report-studio](https://github.com/ciceroyang/dsh-report-studio)
> and getting it listed in the ecosystem. The Chinese original lives in
> [docs/tutorial-zh.md](./tutorial-zh.md).

## Why now

DeepSeek Harness (dsh) is DeepSeek's open-source agent framework: **everything is a
plugin** (models, tools, sessions, skills, UI — all Cordis plugins). It is still in
developer preview, and the core repository does **not** accept external PRs right now.
The sanctioned contribution surface is the ecosystem: publish plugins (tag your repo
with `dsh-plugin`), write guides, answer questions, file issues.

The community awesome list already tracks 900+ public plugins, yet nobody had built
"session → work deliverables". So I built one.

## Two ways to load a plugin

**Install (needs pnpm)**

    dsh plugin --profile <profile> add <package-or-local-path>

It forwards to pnpm inside the profile directory. No pnpm on PATH? Install it first.

**Local dev overlay (no pnpm)**

    # my-report.yml
    - insert:
        - id: report-studio
          name: '/absolute/path/to/dsh-report-studio/index.js'

    dsh --profile headless --patch ./my-report.yml "task"

## Minimal plugin (build-free, pure ESM)

    // index.js
    export const name = 'my-plugin'
    export const inject = ['tools']

    export function apply(ctx) {
      ctx.tools.register(defineTool({
        name: 'greet',
        description: 'Greet someone by name.',
        parameters: {
          name: { type: 'string', required: true, description: 'The name to greet' },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
          return 'Hello, ' + args.name + '!'
        },
      }))
    }

Notes:

- `inject: ['tools']` makes Cordis wait for the tool registry before `apply`.
- `defineTool` comes from `@deepseek-ai/dsh-tools`; `parameters` infers and
  validates args, `output.schema` validates the returned value, `output.render`
  converts it into model-facing content.
- **An object output schema MUST declare `additionalProperties: true`** or
  registration fails. Constrain string parameters with `enum: ['a','b']`;
  optional parameters simply omit `required`.

## Packaging as an installable bundle

    // package.json
    {
      "name": "dsh-report-studio",
      "type": "module",
      "main": "index.js",
      "files": ["index.js", "lib", "skills", "templates", "cordis.patch.yml"],
      "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
    }

    # cordis.patch.yml
    - insert:
        - id: report-studio
          name: dsh-report-studio

Then `dsh plugin --profile web add github:you/your-repo` just works.

## Reading the current session inside a tool

    async execute(args, exec) {
      const session = exec.agent?.session
      if (!session) throw new Error('requires an agent-bound session')
      for (const event of session.events) {
        // envelope: { seq, time, type, data }
      }
    }

Sessions are event-sourced logs. The events that matter most:

| Event | data |
|---|---|
| `turn/start` / `turn/end` | turn boundaries + end reason (completed/blocked/error/aborted/max-tokens) |
| `step/start` / `step/end` | model step boundaries |
| `user/message` | user message (source.kind separates direct from plugin-injected) |
| `assistant/message` | assistant message + usage (input/output/cacheRead/cacheWrite/reasoning tokens) |
| `tool/call` / `tool/result` | tool invocations; raw arguments arrive as a JSON string |
| `todo/write` | todo snapshots (latest wins) |

Cross-session queries have the official `ctx.sessionQuery` service (not mounted in
web by default — treat it as optional).

## Registering a runtime skill

    const skills = ctx.get('skills')   // optional services via ctx.get, not inject
    if (skills) {
      skills.register({
        name: 'work-report',            // kebab-case
        description: 'one-line routing description',
        content: readFileSync(SKILL_FILE, 'utf8'),
        source: 'runtime',
        provider: 'dsh-report-studio',
      })
    }

The skill Markdown is an instruction manual written for the model: when to fire, the
steps, which tool each step calls, and hard rules (e.g. "no unfilled slots may
remain before saving"). It is injected on demand and costs no standing tokens.

## The pitfalls I actually hit

1. **Module resolution for `--patch` absolute-path plugins**: bare imports inside the
   plugin resolve from the plugin's own directory upward; if they are missing, boot
   fails. The official tutorial only works because its scratch plugin lives inside the
   repo checkout. For local dev, symlink the deps:

       mkdir -p node_modules
       ln -s ~/.dsh/profiles/node_modules/@deepseek-ai node_modules/@deepseek-ai

   (Real `dsh plugin add` installs are unaffected — pnpm resolves peers from the profile.)

2. **The headless bundle cannot be installed into a fresh profile**: it depends on a
   package that is not on npm. For e2e runs, use the default headless profile + `--patch`.

3. **Missing pnpm**: `dsh plugin` fails with "pnpm not found on PATH". Behind
   restricted networks, install from a mirror.

4. **Node 26 changed `node --test tests/`**: the directory argument is treated as a
   module. Just run `node --test` and let it discover `*.test.js`.

5. **Placeholder validation must actually validate**: `report_save` rejects reports
   with unfilled slots left over — and during e2e, the guard really caught one
   model output. Guards are not decoration; test that they fire.

6. **DSH session logs are multi-frame zstd**: reading historical sessions (for a
   cross-session weekly, say) with Node's `zstdDecompressSync` silently yields
   only the FIRST frame — just the header line, no events. The logs are
   concatenated-frame containers. Scan the frame structure first (magic
   0xFD2FB528, frame-header descriptor, block-header loop) and decompress each
   frame separately; the official dsh-session-persistence-jsonl format.ts
   (`scanZstdFrames`) is MIT and copyable.

## Test & publish checklist

- Unit-test every pure function (extraction/rendering/hashing/path safety) with
  node:test; assert hashes against known vectors (sha256('abc')).
- e2e: default headless profile + `--patch`, one real task, then verify the saved
  file and recompute the receipt hashes independently.
- Publish: `gh repo create you/your-repo --public --source . --push`, then
  `gh repo edit --add-topic dsh-plugin`.
- Get listed: open a PR against awesome-deepseek-harness (both language READMEs,
  one entry each; propose a new category if none fits — that is exactly what my
  "Output & Deliverables" PR does).

## A complete example to copy

[dsh-report-studio](https://github.com/ciceroyang/dsh-report-studio): session →
daily/weekly/handoff/article reports with verifiable receipts. Layout:
`index.js` (host plugin) + `lib/` (pure functions) + `templates/` (Markdown)
+ `skills/` (SKILL.md) + `tests/`. MIT — copy freely, PRs welcome.

---

The Harness team wrote it down themselves: community packages are no less important
than official ones. The blanks are still everywhere. Go build something.
