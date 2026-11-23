# agent-device: direction, market position, and roadmap (November 2026)

This is a planning document, not a decision record. Decisions that come out of it belong in ADRs and issues.

## 1. Where the project is today

Signals from the repository and public data, as of 2026-11-23:

| Signal | Value |
| --- | --- |
| npm downloads | ~846k last week, ~2.9M last 30 days |
| GitHub | ~5.5k stars, ~425 forks (callstack/agent-device) |
| Commit velocity | 117 (May) → 266 → 367 → 453 → 547 → 706 (Oct) → 484 (Nov so far) |
| Open upstream issues | 121 |
| Targets in the capabilities matrix | 23 (mobile, TV, desktop, web, 5 cloud providers) |
| Distribution | Expo Agents docs, EAS workflow template, e2e.com, T3 Code, MCP directories |

What the last three months of work went to (commit scopes since 2026-08-23):

- **Mostly reliability on the core targets.** `fix ios` (132), `fix daemon` (80), `fix android` (74), plus apple-runner, ios-runner and snapshot fixes.
- **Internal structure.** `refactor daemon`, `refactor move`, the ReasonTable migration, ADRs 0029–0040, layering and Fallow gates.
- **Breadth.** Tizen, webOS, Revyl, watchOS, Fire OS, macOS apps as devices, web sessions as devices, and native accessibility audits.
- **Performance work that has evidence.** Android tap 106 → 53 ms p50, fill 558 → 275 ms, screenshot 1238 → 69 ms. iOS selector tap 5.5 s → 0.67 s.

The product is no longer short on features. It is short on a dependable first run and a fast inner loop on the two targets that bring most of the users, and it carries a growing maintenance surface.

## 2. Market map

The category has settled into four groups:

1. **OSS device layers for coding agents.** mobile-mcp (largest mindshare, ~8–10k stars, Mobile Next Cloud upsell), agent-device, Appium MCP, Argent (Software Mansion, RN-focused, listed beside agent-device in the Expo docs), XcodeBuildMCP (now Sentry), DroidRun, and Midscene.js (vision-first, ~15k stars, also covers HarmonyOS).
2. **Test frameworks adding MCP.** Maestro (`maestro mcp`, Viewer, Cloud) and Appium. Maestro is the closest strategic rival on deterministic replay.
3. **Cloud runtimes and device farms with MCP/CLI.** Limrun, Revyl, BrowserStack, Sauce, TestMu AI, Expo Simulators. Each one is tied to a single vendor.
4. **Platform owners.** Xcode 26.3 exposes Xcode over MCP, and Android Studio has Agent Mode and Journeys (vision, Android only).

Trends that matter for us:

- **"Verify your change on a device" is now the headline use case.** Every vendor pitches it. Evidence attached to the PR is becoming table stakes.
- **CLI + skills is winning over MCP for coding agents.** Examples: GitHub Agentic Workflows dropping Playwright MCP, Microsoft's own guidance, Expo skills. MCP stays the path for IDEs and hosted agents, so having both is an advantage.
- **The competition is on token cost and latency.** Published web numbers show 4–40x token gaps between approaches. No mobile tool publishes comparable benchmarks yet.
- **Structured tree vs vision.** Developer-loop tools use the tree, and vision takes over where the tree fails (canvas, games, video, some TV UIs). The emerging pattern is tree first, vision fallback.
- **Enterprises want determinism.** That means model-free replay in CI, audit trails, parallelism, and reporting.

### The niche to own

**A neutral, deterministic device runtime for fleets of coding agents.** In one sentence: any agent, any target, any cloud, one session and evidence model, and runs that compile to model-free replays for CI.

No competitor combines all of these:

- **Breadth under one selector and session model.** Phones, TV, desktop, web, HarmonyOS.
- **Neutrality across clouds.** Farm MCPs lock you to one vendor. agent-device can be the "Terraform of device clouds".
- **Exploration that compiles to replay.** The agent explores once, and the result becomes an `.ad` script or Maestro YAML that runs in CI without a model.
- **Parallel-agent coordination.** Sessions scoped to the worktree, plus device claims. Device contention grows as teams run many agents at once.
- **Evidence depth.** Network, performance, React profiles, video, and accessibility audits.

Main threats:

- Platform owners absorbing the basic loop (Xcode MCP, Android CLI and Journeys).
- Maestro bundling MCP, Viewer, and Cloud on top of its installed base.
- mobile-mcp's adoption lead.
- Argent in the React Native/Expo channel.
- Cloud vendors (Revyl, Limrun) moving up into the client.

## 3. Strategic answer: depth and speed before breadth

The open question was whether to focus on platforms or on performance. Recommendation: **stop adding targets for two to three months.** Spend that time on:

1. First-run reliability.
2. Inner-loop latency and token cost on iOS and Android.
3. The explore → replay → CI pipeline as the moat.

Platform work should close gaps on existing targets, not open new ones.

Reasoning:

- Most users and most `fix` commits are on iOS and Android. A flaky first `open` on a fresh simulator loses a user before any breadth matters. Examples: #4570, #4569, #4412, #5004.
- Breadth is already the widest in the market. Each new target adds runner, transport, capability, and doc surface to a codebase that is already spending most of its effort on internal refactors.
- Latency and token cost are the axis on which the agent tools are being compared. We have the evidence pipeline (`pnpm bench:*`, `docs/evidence`) to win there publicly.

## 4. Platform assessment

Gap counts come from `website/docs/docs/capabilities.md`. "No" means at least one command in the row is refused on that target.

| Target | Yes / No | Verdict |
| --- | --- | --- |
| iOS Simulator, Android emulator | 34–35 / 4 | **Core.** Polish reliability and speed. Do not add commands. |
| Android device, Android TV / Fire OS | 31 / 9 | Strong. Close the remaining gaps users ask for (lock/unlock #4798, hardware keyboard #4786, locale #5005). |
| iOS device (CoreDevice) | 27 / 10 | **Polish.** Wi‑Fi taps fail (#4107). Unattended signing needs ASC API key support (#4961). Physical devices are what enterprise QA buys. |
| tvOS sim/device | 32 / 8, 27 / 14 | Polish the focus-engine snapshot bugs (#4654, #4653, #4713). TV is a real white space, so keep it healthy. |
| Limrun iOS/Android | ~30 / 8–9 | Good. Finish network HAR (#4064). |
| BrowserStack / TestMu / AWS Device Farm | ~20 / 19–21 | **Polish.** The neutral-cloud story depends on these reaching Limrun-level parity: logs, recording, network, app install. |
| Revyl iOS/Android | 12–13 / 25–26 | Polish to parity, or label as preview. |
| HarmonyOS | 19–20 / 18–19 | Keep improving at a steady pace. Only Midscene competes here, and it matters for the Chinese market. |
| macOS desktop / app | 20–22 / 18–21 | Medium. Useful for Electron and Catalyst. Follow-ups are in #3213. |
| Web | 12 / 28 | **Decide.** Playwright and agent-browser own web. Either keep web as a thin path for hybrid apps (webviews, auth flows) and say so, or invest. Recommendation: keep it thin, document "use agent-browser/Playwright for web-first work", and make the webview and auth-sheet hand-offs inside mobile apps work well. |
| Linux desktop | 14 / 27 | Low priority. The main value is CI hosts and remote runners, not Linux apps. |
| Vega OS (VVD) | 3 / 37 | **Decide.** Finish it with Amazon's backing, or mark it experimental and move it out of core with the plugin extraction (#4740). |

New targets, if and when breadth resumes, in order of value:

1. **Roku.** Completes TV coverage. BrowserStack lists Roku as "coming soon", and no agent-native OSS tool covers it.
2. **Wear OS.** watchOS already landed.
3. **Android Automotive / CarPlay simulator.** No agent-native tools exist. It is a niche but distinctive.
4. **Vision fallback as a cross-cutting "target".** Use VLM grounding for canvas, game, video, and custom-drawn surfaces (HarmonyOS web, some TV UIs). It answers Midscene and AskUI without giving up tree-first determinism.

## 5. Performance focus

Make performance a product feature with published numbers, not only internal evidence.

- **Agent-loop benchmark.** Publish tokens per task, wall time per task, and commands per task for a fixed set of flows (Contacts add, checkout form, login with an auth sheet). Compare against mobile-mcp, Appium MCP, and Maestro MCP, on iOS and Android, CLI and MCP. Re-run it in CI on release and publish it on agent-device.dev.
- **iOS text entry.** A 19-character fill still takes 2.0–3.3 s (`ios-other-paths-latency-2026-10-19`). Back-pressure from the field instead of a fixed characters-per-second rate (#2906) is the obvious next lever.
- **Adaptive settle budget (#4829).** The default `--settle` cannot succeed on devices where capture is slow. Cloud devices are slow to capture, so this blocks cloud quality.
- **Cold start and first open.** Measure and cut: daemon start, runner build and handoff on a fresh simulator, helper install on Android. Today cold open has one sample per run, so start by benchmarking it properly.
- **Ref churn.** Ref errors after `--settle` cost agents extra commands (#4571, #4476). Fewer wasted turns is the largest token saving available.
- **Remote round trips.** Handle health waits, artifact transfer, and lease setup within the command deadline (#4567, #4441, #4522).

## 6. Roadmap

### Now: next 6–8 weeks ("first run just works, the loop is fast")

1. **First-run reliability on fresh simulators and emulators.** Cover the runner build timeout on first open, the keyboard intro sheet, the dropped first tap, and the remote first open (#4570, #4569, #4412, #5004). Success criterion: a cold-machine `doctor` → `open` → `snapshot` → `press` passes 50/50 on CI for iOS and Android.
2. **Publish the agent-loop benchmark** (Section 5) with a baseline, including the competitor comparison.
3. **iOS fill latency and adaptive settle** (#2906, #4829).
4. **Fewer wasted agent turns.** Address ref expiry in batch and settle (#4571, #4476). Measure commands per task in the benchmark.
5. **Finish in-flight structural work, then freeze large refactors.** That means ReasonTable R7/R8 (#4937), ADR 0040 steps 6–7, and Request Scope (#4789). Set a budget so refactors stop crowding out user-facing work.

### Next: Q1 2027 ("explore → replay → CI is the moat")

1. **Replay as a product.** Parameterized and composable scripts already exist (ADRs 0017, 0020). Add rect assertions (#4804), configurable Maestro waits (#4204), a flakiness report per step, and a reviewer-friendly HTML run report with evidence.
2. **Evidence attached to the PR.** Ship first-class GitHub Actions and EAS templates that post screenshots, video, a perf diff, and an accessibility audit diff on PRs. Offer an OSS, self-owned equivalent of Revyl's "behavioral record".
3. **Cloud parity.** Bring BrowserStack, TestMu, and AWS Device Farm close to Limrun. Ship the shared lease table (#4102), the durable rental journal (#4972), and per-lease options (#3758).
4. **Physical iOS for unattended CI.** Add ASC API key signing (#4961), fix Wi‑Fi transport (#4107), and refuse on a locked device (#2861).
5. **Plugin extraction for 0.22 (#4740, #3747).** Move secondary targets (Vega, Tizen, webOS, Linux, the web path) and providers out of core. This shrinks the core gate cost and lets those targets move at their own pace.

### Later: H1 2027 ("fleets and new surfaces")

1. **Multi-agent fleets.** Add device pools, scheduling, and quotas across local plus cloud. Coordinate several devices in one session (closed #100, worth reopening). Add a dashboard of who holds which device.
2. **Optional vision fallback** for surfaces with no accessibility tree. Keep it behind an explicit flag, record it in replay as coordinates plus an image anchor, and never make it the default.
3. **New targets:** Roku, then Wear OS, then Android Automotive. Ship them only as plugins, after the extraction.
4. **Team/enterprise layer.** Add SSO for the remote proxy, audit logs, and retention policies for artifacts. This is the natural commercial seam for Callstack services, alongside e2e.com.

### Keep doing continuously

- Native accessibility audits on Android (#4761). Accessibility is a differentiator that also improves snapshot quality.
- React Native depth: profiling, Fabric, the Expo dev menu (#5003). This defends the Expo/RN channel against Argent.
- Distribution: Expo docs, agent skill marketplaces, MCP directories, and Claude Code, Codex, and Cursor plugin listings.

## 7. Metrics to track

- First-run success rate on a clean machine, per target.
- Tokens, wall time, and commands per benchmark task, per release.
- p50/p95 latency for tap, fill, snapshot, screenshot, and cold open, per target.
- Pass rate of the same replay over N runs on local devices and on each cloud provider.
- Ratio of open `bug` issues to closed ones, and how many open issues are `ready-for-agent`.
- Share of commits that are `fix`/`feat` with user-visible effect vs `refactor`/`chore`/`gates`, as a guard against internal work crowding out product work.

## 8. Open questions for maintainers

1. Is web a strategic target or a convenience path? Section 4 recommends the latter.
2. Does Vega have an owner and a partner commitment, or should it move to a plugin as experimental?
3. Is there appetite for publishing head-to-head competitor benchmarks, or only absolute numbers?
4. Should vision fallback live in core or in a plugin?
5. Where is the line between the OSS runtime and a paid team or fleet offering?

## Sources

Repository data: `git log`, `website/docs/docs/capabilities.md`, `docs/evidence/*`, `docs/adr/*`, upstream open issue titles (GitHub search).

Market sources:

- https://docs.expo.dev/agents/
- https://github.com/mobile-next/mobile-mcp
- https://github.com/appium/appium-mcp
- https://maestro.dev/blog/maestro-mcp-for-ai-coding-agents
- https://revyl.com/
- https://limrun.net/
- https://swmansion.com/blog/argent-agentic-toolkit-to-control-debug-and-profile-ios-applications
- https://blog.sentry.io/sentry-acquires-xcodebuildmcp
- https://www.apple.com/newsroom/2026/02/xcode-26-point-3-unlocks-the-power-of-agentic-coding/
- https://developer.android.com/studio/gemini/journeys
- https://github.com/web-infra-dev/midscene
- https://github.github.com/gh-aw/blog/2026-09-01-why-playwright-cli-replaces-playwright-mcp/
- https://www.checklyhq.com/blog/mcp-vs-cli-token-efficiency/
- https://www.browserstack.com/docs/browserstack-mcp-server/overview
- https://www.witbe.net/articles/agentic-ai-smart-tv-quality-assurance/

Competitor star counts come from third-party snapshots and are approximate.
