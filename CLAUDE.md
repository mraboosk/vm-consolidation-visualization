# CLAUDE.md

## Project

Browser-based visualizer that compares VM-consolidation algorithms on the same
randomly-generated OpenStack-style cluster. Currently ships **BalCon** and
**PheCon** (pedagogical approximations — see `README.md` for caveats).

## Architecture

The app lives in a single file: **`index.html`**. There is no build step, no
dependencies, no framework. Open it in a browser to run it. The whole app is one
IIFE in the `<script>` block at the bottom.

Shared cluster constants live in **`constants.js`**, loaded as a classic
`<script>` before the IIFE (it exposes `HOST_CPU`, `HOST_RAM`, `INSTANCE_TYPES`
as globals in the browser, and `module.exports` for Node). The test scripts
`require('./constants.js')` instead of duplicating them.

Key pieces inside that IIFE:

- **Constants**: `HOST_CPU`, `HOST_RAM`, `INSTANCE_TYPES` (from `constants.js`).
- **Cluster model**: `generateCluster(seed, hostCount, serverCount, targetPct)`
  produces `{ hosts, servers, placement, seed, requested }`. `placement` maps
  `serverId → hostId`.
- **Helpers**: `computeHostLoads(state)`, `activeHostCount(state)`,
  `activeHostCountFromPlacement(state, placement)`.
- **Algorithms**: `runBalCon(initial)` and `runPheCon(initial)`.
- **UI / state**: `results`, `renderStats`, `renderCluster`, `runAlgo`,
  `animateMigrations`, and the button wiring near the bottom.

## The algorithm contract

An algorithm is a pure function `run<Name>(initial)` where `initial` is a cluster
state (`{ hosts, servers, placement, seed, ... }`). It must NOT mutate `initial` —
clone first: `const state = { ...initial, placement: { ...initial.placement } };`

It must return:

```js
{
  finalPlacement,   // { serverId: hostId } — the resulting placement
  migrations,       // ordered array of { serverId, from, to, step }
}
```

`migrations` is the animation script: each entry moves one server from `from` to
`to`, replayed in order by `animateMigrations`. The order matters — later
migrations may depend on capacity freed by earlier ones.

Consolidation rule of thumb: **only relocate onto hosts that already host at
least one server** (`loads[h.id].servers.length > 0`). Moving a VM onto an empty
host is anti-consolidation. Respect capacity: a target's remaining CPU and RAM
must both be ≥ the server's `cpu`/`ram`.

## Adding a new algorithm

1. **Write `run<Name>(initial)`** next to `runBalCon` / `runPheCon` in
   `index.html`, following the contract above. Use `computeHostLoads(state)` to
   get per-host `{ cpu, ram, servers }`. Push a `migration` for every server you
   move and apply it to `state.placement` so subsequent steps see updated loads.

2. **Verify it outside the browser** with a Node script in the repo root (see
   "Testing" below) before wiring up any UI. Confirm it frees hosts, never
   overflows a host, and terminates.

3. **Add state**: extend `results` to include your algo key, e.g.
   `let results = { bal: null, phe: null, <key>: null };`.

4. **Add a button** in the `.btn-row` of the controls markup, mirroring
   `#btn-balcon` / `#btn-phecon`. Give it an id and a color class.

5. **Wire it up**: in `runAlgo(which)`, map your `which` value to the runner
   (the `(which === 'bal' ? runBalCon : runPheCon)` dispatch and the
   `tag`/`cls`/name ternaries). Add a `btn<Name>.addEventListener('click', ...)`.
   Update `setButtons()` to enable/disable and toggle `.active` for the new button.

6. **Surface results**: add a `.stat` card in `renderStats()` for the new algo
   (freed hosts + migration count), and update the Δ-advantage comparison if you
   want it included.

7. **Pick a color**: add CSS custom properties (mirroring `--balcon` / `--phecon`)
   and the matching `button.btn.<class>` and `.stat.<class>` rules in `<style>`.

## Testing

There is no test runner. Verification scripts are standalone Node files in the
repo root named `test-*.js` (e.g. `test-balcon.js`, `test-phecon.js`). Each one
`require('./constants.js')` for the shared constants, then **copies**
`mulberry32`, `generateCluster`, the load helpers, and the algorithm out of
`index.html`, then runs it across several seeds and prints freed-host /
migration counts.

Run with: `node test-<name>.js`

When you add or change an algorithm, add or update the matching `test-*.js` and
run it. Keep verification scripts in the repo root — do **not** put them in
`/tmp`. Constants are now sourced from `constants.js` (shared, not copied). If
you change another shared piece (`generateCluster`, a load helper) in
`index.html`, update the copies in the test files too, since those remain
duplicated by design (the test files are otherwise self-contained Node scripts).
