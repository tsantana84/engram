# Journey Into Engram

*A technical narrative of a fork born from a simple question: what if Claude Code's memory wasn't local?*

---

## 1. Project Genesis

Engram did not start from scratch. It started from a question.

The upstream project — `claude-mem`, a Claude Code plugin built by thedotmack — already solved the hardest part of the problem: capturing what Claude does across sessions, compressing observations into semantic memory, and injecting that context back into future conversations. By version 12.1.0, it had a mature five-hook lifecycle, a SQLite-backed observation store, a Chroma vector index, an MCP search server, and a React viewer UI. It was a complete, working system for *individual* persistent memory.

What it didn't do was share.

Engram's founding insight was that teams of engineers — or teams of Claude Code instances acting on their behalf — should be able to pool their memory. If three engineers are working on the same codebase from different machines, each running their own Claude Code instance, their accumulated context should be visible to each other. "thiago," "frida," and "olga" should not have to rediscover the same architectural decisions, the same debugging sagas, the same gotchas, in isolation.

The fork was created on April 14, 2026, with commit `3cce2e44`, which added `CLAUDE_MEM_SYNC_*` settings to `SettingsDefaultsManager.ts`. That was the founding technical decision: rather than designing a new plugin from zero, take v12.1.0 of claude-mem, add a sync layer on top, and push observations to a shared Supabase/Vercel backend. The name chosen — engram — is a neuroscience term for the physical trace of a memory in neural tissue. The metaphor was deliberate: where claude-mem was memory for one mind, engram was memory as a shared neural substrate across many.

---

## 2. Architectural Evolution

**Day One: The Sync Scaffold (April 14, afternoon)**

The core sync architecture landed in a tightly concentrated burst between 14:56 and 15:22 on April 14. In under thirty minutes of commit time, five foundational features were merged:

- `feat: add sync_queue table (migration 26)` — a new SQLite table to queue outbound observations for upload
- `feat: implement SyncQueue for local sync job management` — the queue abstraction itself
- `feat: implement SyncClient HTTP client and API key auth` — the outbound HTTP client targeting the Vercel/Supabase backend
- `feat: implement PostgresManager and server HTTP routes for multi-agent sync` — server-side routes on the backend
- `feat: implement ServerService, CLI commands, and SyncWorker for multi-agent sync` — the wiring layer that brought it all together

The commit `95440aca` is the largest in the project: a 4,622-line addition that created the `SyncWorker`, CLI commands (`server.ts`, `sync.ts`), and included a 3,338-line implementation plan document. This is a system where the planning artifact lived directly in the repository, inside `.plans/`, alongside the code it described.

The initial architectural decision was to run a self-hosted server alongside the Vercel function layer. `PostgresManager.ts` pointed at a local or remote PostgreSQL instance, and `ServerService.ts` managed it. Docker files were created for deployment. This was a two-tier architecture: a local worker daemon (already present from claude-mem) extended with a sync loop, talking to a cloud backend that stored cross-agent observations.

**The Pivot: Supabase and Vercel Replace the Self-Hosted Server**

By April 15, the Docker files were deleted (`docker/Dockerfile.server`, `docker/docker-compose.yml` appear as `D` in git status), `ServerService.ts` was deleted, and `AgentRoutes.ts`, `SyncRoutes.ts`, and `TeamSearchRoutes.ts` were all deleted. A new `SupabaseManager.ts` appeared as an untracked file alongside a `supabase/` directory and a `vercel.json`.

This pivot — from self-hosted Postgres plus custom server to fully managed Supabase plus Vercel functions — removed an enormous operational burden. Engineers don't need to run a server. The backend is always on, regionally distributed, and free-tier accessible. The local daemon still runs for AI processing, but the sync layer is cloud-native. This is the architecture that reached the "3 active agents" and then "4 active agents" milestone visible in observations 45 and 75.

**The Identity Problem: claude-mem vs. engram**

Before the sync architecture could be properly exercised, the fork had a more basic problem: it was still calling itself `claude-mem`. Between midnight and 1:00 AM on April 15, eight consecutive commits renamed things:

- `fix: update hooks.json cache fallback from claude-mem to engram` (5ead82eb)
- `fix: rename plugin identity references from claude-mem to engram` (e27d3232)
- `fix: rename data directory from .claude-mem to .engram` (d5e2fd10)
- `fix: update remaining .claude-mem references to .engram` (2356f40e)
- `fix: normalize boolean settings to strings` (bb5849cb)
- `build: rebuild worker-service.cjs with .engram paths` (c2f99466)
- `fix: update remaining .claude-mem user-facing messages and comments` (a1640a0d)
- `fix: update plugin key from 'engram' to 'engram@thedotmack' in plugin-state.ts` (b9fe12ec)

This renaming cascade is one of the clearest indicators of how quickly the fork moved from concept to shipping: the multi-agent sync system was implemented first, then the identity was cleaned up afterward. The plugin key issue (`engram` vs. `engram@thedotmack`) was particularly subtle — it governed how Claude Code's plugin registry matched the installed plugin to the running hooks, and getting it wrong meant hooks silently stopped sending data to the daemon. That specific bug is now documented in the project's cross-session memory at `/Users/thiagosantana/.claude/projects/-Users-thiagosantana-projects-cint-engram/memory/MEMORY.md`.

---

## 3. Key Breakthroughs

**Breakthrough One: The Sync Pipeline Goes Live**

Observation 11 in the timeline captures the moment: *"Multi-Agent Sync Successfully Enabled After Configuration; Log Tag Padding Was Masking It."* This is a classic debugging false negative — the sync was already working, but the log output format was making it appear absent. After restarting the worker with corrected settings (and migrating the settings file from `~/.claude-mem` to `~/.engram`), the `[SYNC]` log entries finally appeared. 113 observations were shown as synced, with 1 pending. The pipeline was real.

**Breakthrough Two: Cross-Agent Search**

Observation 47 marks it: *"Fixed Cross-Agent Team Search: Three Bugs Resolved in SyncClient and SearchManager."* This was the functional completion of the core value proposition. Push-only sync (obs. 46 noted that cross-agent search was not yet implemented) became bidirectional. The fix commit `167c40fe` tells the story precisely in its message: three bugs, each attacking a different layer:

1. `SyncClient.searchTeam` sent `query` as the parameter name, but the Vercel API expected `q`.
2. `SearchManager` looked for `teamResults.observations` but the API returned `teamResults.results`.
3. After merging results, the `source` field was being overwritten back to `'local'`, erasing the team attribution.

These are the three classic integration bugs: wrong parameter name, wrong response key, wrong post-processing. Each one would have silently produced empty results without an obvious error. The fact that all three were fixed in a single commit (`167c40fe`, 9 insertions, 21 deletions — a net reduction) suggests they were diagnosed in one concentrated session rather than discovered incrementally.

**Breakthrough Three: The Install Experience**

The `/login` skill (observation 40) was the moment the project became usable by someone other than its author. Before it existed, setting up a new machine required manually editing JSON files, understanding the marketplace system, and knowing to run a force-restart. After it, the install flow became: two commands plus `/login`. Observation 41 records the milestone directly: *"Engram Install Experience: Two Commands + /login."*

---

## 4. Work Patterns

The git history reveals a characteristic development rhythm: concentrated architectural sessions followed by cascading fix sessions.

**Pattern One: Big Feature, Then Name the Mess**

The April 14 afternoon session (14:56–15:22) was pure feature velocity: five commits in 26 minutes, all `feat:`. The April 15 midnight session (00:34–00:52) was almost entirely `fix:` — eight small commits cleaning up identity strings, path references, and cache keys. The feature existed but needed its seams sealed. This is not undisciplined coding; it's a deliberate pattern of "get it working, then get it right."

**Pattern Two: Spec-First Planning**

The presence of a 3,338-line implementation plan in `.plans/2026-04-14-multi-agent-sync.md` (committed inside `95440aca`) and a separate 336-line design spec in `.plans/specs/` indicates planning artifacts were treated as first-class deliverables, not throwaway notes. Two subsequent commits on April 15 (00:25, 00:29, 00:32) fixed N1/N2 errors and five blocking issues in the install plan document — the written plan was being actively maintained alongside the code.

**Pattern Three: Validation Through Deployment**

By observation 65, a presentation deck (`engram-pitch.surge.sh`) had been deployed to a public URL. By observations 70–77, it had gone through five iterations: initial dark-theme version, mobile-friendly update, SVG architecture diagram, status/roadmap slide, and engineer-focused diagram. The presentation was not documentation — it was validation. Building it forced clarity about what the product actually was, and the iterations (particularly the "honest framing" of the partial memory gap in obs. 52) show that the development process included self-critique.

---

## 5. Technical Debt

Several shortcuts are visible in the record.

**Debt One: Migration Version Collision**

Commit `f85b4f80` — *"bump MigrationRunner createSyncQueueTable to version 27 to avoid collision"* — exists because the sync queue migration was originally registered as migration 26, which collided with an existing migration in the upstream claude-mem codebase. This required a corrective commit immediately after the initial implementation (`75fca5dc`). The root cause was adding migrations without checking the upstream version table.

**Debt Two: Boolean/String Normalization**

Commit `bb5849cb` — *"normalize boolean settings to strings; fix server.ts sync enabled output"* — reveals that the sync-enabled setting was being stored as a boolean in some paths and a string in others. The symptom was that sync appeared disabled when it was enabled, depending on which code path read the setting. This class of bug (type coercion in configuration) is a signal that the settings schema lacked validation.

**Debt Three: The Self-Hosted Architecture That Was Deleted**

`ServerService.ts`, `AgentRoutes.ts`, `SyncRoutes.ts`, `TeamSearchRoutes.ts`, and the Docker files were all created and then deleted. Hundreds of lines of server infrastructure were written for a deployment model that was abandoned in favor of Supabase. This is not wasted work — the routes and service patterns informed the Vercel function design — but it represents real scope that was superseded.

**Debt Four: The .gitignore Scope Bug**

Observation 36 records: *"Fixed .gitignore to Scope /.mcp.json to Root Only; plugin/.mcp.json Now Syncs."* The `.gitignore` pattern `/.mcp.json` (root-scoped) was correct, but the original pattern was `**/.mcp.json` or simply `.mcp.json` (unscoped), which caused `plugin/.mcp.json` — a file needed for the MCP server configuration on new machines — to be excluded from the repository. Any engineer installing engram on a new machine would find the MCP server silently absent.

---

## 6. Challenges and Debugging Sagas

**Saga One: Why Isn't Sync Working?**

Observations 1–11 reconstruct a debugging session conducted at 12:59–1:01 AM on April 15. The worker was healthy. The queue showed 113 synced, 1 pending. But the settings said sync was disabled — and then, on checking, the settings had been read from `~/.claude-mem` rather than `~/.engram`. After migrating the settings file (obs. 4) and force-restarting the worker (obs. 5), the logs still showed no `[SYNC]` entries (obs. 6, 8). After nine worker restarts (obs. 10), the conclusion was finally reached: log tag padding in the output was visually masking the `[SYNC]` entries — they were present but not visible in the format being observed. The sync had been working the whole time.

This is a particularly instructive debugging story: the system was correct, the observation method was wrong.

**Saga Two: New Machine Install**

Observations 29–39 document what happened when engram was installed on a second machine. The plugin files were present at the right path. But `known_marketplaces.json` was missing the `thedotmack` entry, which meant the plugin couldn't be enabled through normal channels — it required manual JSON editing (obs. 33–34). More critically, `plugin/.mcp.json` was absent because the `.gitignore` bug (obs. 35) had excluded it from the repository. Without the MCP server config, the search skill was completely non-functional. These two bugs together would have made engram completely broken for any new user.

**Saga Three: Team Search Returns Zero**

Observations 57–64 chronicle the cross-agent search debugging. The search API was returning an `INVALID_SEARCH_REQUEST` error when no query was provided (obs. 57–58). Even with a query, the memory store had 3 observations but returned zero results (obs. 59). The Vercel endpoint was returning results, but the local team search was not (obs. 63). This led to the three-bug analysis: parameter name mismatch (`query` vs. `q`), response key mismatch (`observations` vs. `results`), and post-merge source overwrite. Each bug was invisible in isolation — together they produced a silent zero-result response with no error.

---

## 7. Timeline Statistics

**Date range**: April 14, 2026 (14:56 BRST) through April 15, 2026 (10:43 BRST) — approximately 20 hours of active development.

**Total commits in the engram fork**: 32 commits ahead of the upstream claude-mem baseline (as of obs. 18), plus additional commits on April 15, totaling approximately 35 engram-specific commits on top of the upstream v12.1.0 tag.

**Observation breakdown from the persistent memory timeline**:
- Total observations: 77 recorded (observations 1–77 in the timeline, across two sessions with a boundary at obs. 28)
- Discovery observations (🔵): ~52 (~68%) — primarily reconnaissance: confirming state, identifying gaps, mapping behavior
- Fix observations (🔴): ~8 (~10%) — bug fixes: URL correction, settings migration, cross-agent search bugs, .gitignore scope
- Change observations (✅): ~9 (~12%) — deliberate actions: restarts, commits, pushed changes
- Feature observations (🟣): ~4 (~5%) — new capabilities: ENGRAM.md creation, /login skill, install script
- Decision observations (⚖️): 0 recorded explicitly, though several observations describe outcome of decisions

**claude-mem persistent memory stats at time of export**: 158 observations, 592,135 tokens of work processed, 93% token savings through compression.

**Peak development velocity**: April 14, 15:05–15:22 — five feature commits in 17 minutes.

**Longest gap**: April 8 (upstream claude-mem v12.1.0 release) to April 14 (engram sync scaffold) — six days from fork creation to first feature commit, likely the period when the architecture was being designed.

---

## 8. Lessons and Meta-Observations

**The fork boundary is a forcing function.** By taking an existing, working plugin at version 12.1.0 and adding a sync layer on top, the project avoided reimplementing the hard parts (hook lifecycle, SQLite migrations, Chroma integration, Bun process management) while focusing entirely on the new value. The technical debt inherited (the `claude-mem` identity strings scattered throughout) was the direct cost of this strategy, and the midnight renaming session was the tax payment.

**Config systems are load-bearing and fragile.** Three separate bugs in this 20-hour window were configuration problems: the settings path migration (`.claude-mem` vs. `.engram`), the boolean/string normalization failure, and the `engram` vs. `engram@thedotmack` plugin key mismatch. In a plugin whose core value is persistent state, configuration correctness is not a secondary concern. Each of these bugs could silently disable the product without producing an error message.

**Integration bugs cluster at API boundaries.** The three bugs in cross-agent search (`query` vs. `q`, `observations` vs. `results`, source overwrite) are textbook API integration failures. They all occurred at the boundary between the local `SyncClient` and the Vercel function. The fix was 9 insertions and 21 deletions — the deletions primarily being dead code that had accumulated around the incorrect assumption. The lesson is familiar but persistent: API contracts should be tested against the live endpoint before being considered correct.

**Presence on multiple machines is where identity bugs surface.** The project works correctly on the development machine because the development machine has accumulated state: the right `.mcp.json`, the right `known_marketplaces.json` entry, the right settings file. A second machine has none of this. The new machine install saga (obs. 29–43) forced the project to confront every assumption it had made about pre-existing state. The `/login` skill and the install script were the direct results of that confrontation.

**The presentation was diagnostic.** Building `engram-pitch.surge.sh` through five iterations (obs. 50–77) was not a distraction from engineering — it was a form of product validation. The note in obs. 52 about "honest framing of partial memory gap" is particularly telling: the act of writing a slide forced acknowledgment that cross-agent search wasn't working yet, which directly preceded the debugging session that fixed it. The presentation deadline created pressure that surfaced the bug.

**Multi-agent memory as infrastructure.** The deeper lesson of engram is about what kind of problem it's actually solving. Claude Code's existing memory system treats each instance as independent. Engram treats multiple instances as a team. The architectural parallel to distributed systems is exact: what local memory is to a single process, engram is to a cluster. The sync queue, the idempotent upsert semantics, the agent registry in Supabase, the merged search results tagged by source — these are all standard distributed systems patterns applied to the novel domain of AI cognition persistence. The project was built by one engineer in one day, but the idea it implements is a fundamental infrastructure primitive for collaborative AI work.

---

*Generated April 15, 2026 from 158 persistent memory observations, 77 engram-specific timeline entries, and 35 git commits.*
