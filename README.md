# VM Consolidation Visualizer: BalCon vs PheCon

An interactive, browser-based visualization that compares two VM-rebalancing
algorithms — **BalCon** and **PheCon** — on the same randomly-generated
OpenStack-style cluster.

## What it does

- Generates a 10-host cluster with each host sized at 32 vCPU / 64 GB RAM.
- Populates the cluster to about 60% utilization with VMs of seven flavors
  (balanced, CPU-heavy, RAM-heavy mixes).
- Runs either BalCon or PheCon against the *same* initial placement and
  reports the resulting active hosts, empty hosts, and migrations used.
- Provides a reset button to restore the original placement (without
  generating a new random cluster) so the two algorithms can be compared
  fairly on identical inputs.

## Live demo

Open `index.html` in any modern browser, or host it on GitHub Pages.

## Why these two algorithms

For rebalancing an existing OpenStack cluster (as opposed to placing new VMs
one at a time), the best-published heuristics are:

- **BalCon** (Gudkov et al., FGCS 2023) — state-adaptive 2D bin packing with
  a "Force Step" that induces migrations to escape local minima. Reported to
  find 99.7% of optimal solutions across 750+ benchmark instances.
- **PheCon** (Zhu et al., ICPP 2024) — flavor-grain consolidation with
  hierarchical swapping. Reported to reduce migrations by ~35% versus BalCon
  while achieving comparable consolidation, and includes native NUMA awareness.

## What you'll see when comparing

On most random clusters:

- Both algorithms reach a similar (often identical) number of empty hosts.
- PheCon typically uses fewer migrations than BalCon, consistent with the
  paper's claim, though the exact ratio varies per cluster.
- Free CPU/RAM headroom per remaining host increases, which is the actual
  rebalancing goal: not just fewer active hosts, but more room on each.

## Important caveats

The algorithms implemented here are **pedagogical approximations** of the
published versions, designed to illustrate the *behavioral differences*
between the two approaches in a browser-runnable form. They are not faithful
reproductions suitable for benchmarking. Specifically:

- BalCon's true state-classification (balance factor → choosing among
  BestFit / ForceFitBalanced / ForceFitLopsided) is simplified.
- PheCon's hierarchical swapping is limited to depth 2 here; the paper
  uses a configurable max-depth.
- Neither implementation models NUMA, anti-affinity, host aggregates, or
  availability zones. A production OpenStack consolidator would.
- Migration cost is counted but not modeled in detail (network bandwidth,
  duration, failure risk).

For real OpenStack consolidation, see OpenStack Watcher and its
`vm_workload_consolidation` strategy as a production-ready starting point.

## References

- BalCon paper: <https://doi.org/10.1016/j.future.2023.07.030>
- PheCon paper: <https://doi.org/10.1145/3673038.3673139>
- OpenStack Watcher: <https://docs.openstack.org/watcher/>

## License

MIT — see `LICENSE`.
