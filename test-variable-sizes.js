// Sanity check: verify variable host/server counts terminate and produce sensible output.
// Re-implements the new generateCluster/runBalCon/runPheCon signatures.
const { HOST_CPU, HOST_RAM, INSTANCE_TYPES } = require('./constants.js');
function mulberry32(a) { return function () { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function randInt(rng, lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }
function generateCluster(seed, hostCount, serverCount, targetPct) {
  const rng = mulberry32(seed);
  const hosts = Array.from({ length: hostCount }, (_, i) => ({ id: 'h'+i, idx: i, capCPU: HOST_CPU, capRAM: HOST_RAM }));
  const mk = (i, t) => ({ id: 's'+i, type: t.name, cpu: t.cpu, ram: t.cpu * 2, hue: 0 });
  const servers = [];
  if (targetPct != null) {
    const targetCpu = (targetPct / 100) * hostCount * HOST_CPU;
    const maxServers = hostCount * HOST_CPU * 2;
    let acc = 0;
    while (acc < targetCpu && servers.length < maxServers) {
      const t = INSTANCE_TYPES[Math.floor(rng() * INSTANCE_TYPES.length)];
      servers.push(mk(servers.length, t));
      acc += t.cpu;
    }
  } else {
    for (let i = 0; i < serverCount; i++) {
      const t = INSTANCE_TYPES[Math.floor(rng() * INSTANCE_TYPES.length)];
      servers.push(mk(i, t));
    }
  }
  const placement = {};
  const load = hosts.map(() => ({ cpu: 0, ram: 0 }));
  const order = [...servers].sort(() => rng() - 0.5);
  const targets = hosts.map(() => randInt(rng, 25, 85));
  for (const s of order) {
    const cands = hosts.map((h, i) => ({ h, i })).filter(c => c.h.capCPU - load[c.i].cpu >= s.cpu && c.h.capRAM - load[c.i].ram >= s.ram);
    if (cands.length === 0) continue;
    const under = cands.filter(c => load[c.i].cpu < targets[c.i]);
    const pool = under.length > 0 ? under : cands;
    pool.sort((a, b) => (load[b.i].cpu + load[b.i].ram) - (load[a.i].cpu + load[a.i].ram));
    const pickIdx = rng() < 0.7 ? 0 : Math.min(pool.length - 1, Math.floor(rng() * Math.min(3, pool.length)));
    const pick = pool[pickIdx];
    placement[s.id] = pick.h.id;
    load[pick.i].cpu += s.cpu; load[pick.i].ram += s.ram;
  }
  const placedServers = servers.filter(s => placement[s.id]);
  return { hosts, servers: placedServers, placement, seed, requested: servers.length };
}
function computeHostLoads(state) {
  const loads = {};
  for (const h of state.hosts) loads[h.id] = { cpu: 0, ram: 0, servers: [] };
  for (const s of state.servers) {
    const hid = state.placement[s.id];
    if (!hid) continue;
    loads[hid].cpu += s.cpu; loads[hid].ram += s.ram; loads[hid].servers.push(s);
  }
  return loads;
}
function activeHostCount(state) { const loads = computeHostLoads(state); return state.hosts.filter(h => loads[h.id].servers.length > 0).length; }
function activeHostCountFromPlacement(state, placement) {
  const counts = {};
  for (const h of state.hosts) counts[h.id] = 0;
  for (const s of state.servers) { const hid = placement[s.id]; if (hid) counts[hid]++; }
  return state.hosts.filter(h => counts[h.id] > 0).length;
}
function runBalCon(initial) {
  const state = { ...initial, placement: { ...initial.placement } };
  const migrations = []; let step = 0; let progress = true;
  while (progress) {
    progress = false;
    const loads = computeHostLoads(state);
    const nonEmpty = state.hosts.filter(h => loads[h.id].servers.length > 0).sort((a, b) => (loads[a.id].cpu + loads[a.id].ram) - (loads[b.id].cpu + loads[b.id].ram));
    for (const donor of nonEmpty) {
      const donorServers = loads[donor.id].servers.slice().sort((a, b) => (b.cpu + b.ram) - (a.cpu + a.ram));
      const trial = { ...state.placement };
      const trialLoads = {};
      for (const h of state.hosts) trialLoads[h.id] = { cpu: loads[h.id].cpu, ram: loads[h.id].ram };
      trialLoads[donor.id] = { cpu: 0, ram: 0 };
      let failed = false;
      for (const s of donorServers) {
        const cands = state.hosts.filter(h => h.id !== donor.id && loads[h.id].servers.length > 0)
          .map(h => ({ h, slack: Math.min(h.capCPU - trialLoads[h.id].cpu - s.cpu, h.capRAM - trialLoads[h.id].ram - s.ram) }))
          .filter(c => c.slack >= 0).sort((a, b) => a.slack - b.slack);
        if (cands.length === 0) { failed = true; break; }
        const target = cands[0].h;
        trial[s.id] = target.id;
        trialLoads[target.id].cpu += s.cpu; trialLoads[target.id].ram += s.ram;
      }
      if (failed) continue;
      for (const s of donorServers) { migrations.push({ serverId: s.id, from: donor.id, to: trial[s.id], step: step++ }); state.placement[s.id] = trial[s.id]; }
      progress = true; break;
    }
  }
  return { finalPlacement: state.placement, migrations };
}
function runPheCon(initial) {
  const ITERS = 16; let best = null;
  for (let iter = 0; iter < ITERS; iter++) {
    const rng = mulberry32(initial.seed * 1000 + iter + 17);
    const state = { ...initial, placement: { ...initial.placement } };
    const localMigrations = []; let step = 0; let progress = true;
    while (progress) {
      progress = false;
      const loads = computeHostLoads(state);
      const nonEmpty = state.hosts.filter(h => loads[h.id].servers.length > 0)
        .map(h => ({ h, score: (loads[h.id].cpu + loads[h.id].ram) + rng() * 80 * (1 - iter / ITERS) }))
        .sort((a, b) => a.score - b.score).map(x => x.h);
      for (const donor of nonEmpty) {
        const sList = loads[donor.id].servers.slice();
        const variants = [
          [...sList].sort((a, b) => (b.cpu + b.ram) - (a.cpu + a.ram)),
          [...sList].sort((a, b) => (a.cpu + a.ram) - (b.cpu + b.ram)),
          [...sList].sort(() => rng() - 0.5),
        ];
        let success = null;
        for (const order of variants) {
          const trial = { ...state.placement };
          const trialLoads = {};
          for (const h of state.hosts) trialLoads[h.id] = { cpu: loads[h.id].cpu, ram: loads[h.id].ram };
          trialLoads[donor.id] = { cpu: 0, ram: 0 };
          let failed = false;
          for (const s of order) {
            const cands = state.hosts.filter(h => h.id !== donor.id && loads[h.id].servers.length > 0)
              .map(h => ({ h, slack: Math.min(h.capCPU - trialLoads[h.id].cpu - s.cpu, h.capRAM - trialLoads[h.id].ram - s.ram) }))
              .filter(c => c.slack >= 0);
            if (cands.length === 0) { failed = true; break; }
            cands.sort((a, b) => a.slack - b.slack);
            const pickIdx = rng() < 0.75 ? 0 : Math.min(cands.length - 1, Math.floor(rng() * Math.min(3, cands.length)));
            const target = cands[pickIdx].h;
            trial[s.id] = target.id;
            trialLoads[target.id].cpu += s.cpu; trialLoads[target.id].ram += s.ram;
          }
          if (!failed) { success = { trial, order }; break; }
        }
        if (!success) continue;
        for (const s of success.order) { localMigrations.push({ serverId: s.id, from: donor.id, to: success.trial[s.id], step: step++ }); state.placement[s.id] = success.trial[s.id]; }
        progress = true; break;
      }
    }
    const freed = state.hosts.length - activeHostCount(state);
    const score = freed * 1000 - localMigrations.length;
    if (!best || score > best.score) best = { finalPlacement: state.placement, migrations: localMigrations, score };
  }
  return { finalPlacement: best.finalPlacement, migrations: best.migrations };
}

// Variable-size scenarios
const scenarios = [
  [1234, 1, 5],     // 1 host: nothing to consolidate
  [1234, 4, 10],    // small cluster
  [1234, 10, 27],   // default
  [1234, 20, 80],   // larger
  [1234, 5, 150],   // over-subscribed: many won't fit
  [1234, 10, 0],    // no servers
  [1234, 30, 100],  // max hosts
];
for (const [seed, h, s] of scenarios) {
  const c = generateCluster(seed, h, s);
  const placed = c.servers.length;
  const baseActive = activeHostCount(c);
  const bal = runBalCon(c);
  const phe = runPheCon(c);
  const balFreed = c.hosts.length - activeHostCountFromPlacement(c, bal.finalPlacement);
  const pheFreed = c.hosts.length - activeHostCountFromPlacement(c, phe.finalPlacement);
  console.log(`hosts=${h} req=${s} placed=${placed} base.active=${baseActive} | BalCon freed=${balFreed} migs=${bal.migrations.length} | PheCon freed=${pheFreed} migs=${phe.migrations.length}`);
}

// Auto (load %) mode: generate until demand reaches target % of total cluster CPU.
console.log('--- auto load% mode ---');
const pctScenarios = [
  [1234, 10, 30], [1234, 10, 50], [1234, 10, 70], [1234, 10, 90], [1234, 20, 80],
];
for (const [seed, h, pct] of pctScenarios) {
  const c = generateCluster(seed, h, null, pct);
  const placedCpu = c.servers.reduce((a, s) => a + s.cpu, 0);
  const loadPct = Math.round((placedCpu / (h * HOST_CPU)) * 100);
  const bal = runBalCon(c);
  const phe = runPheCon(c);
  const balFreed = h - activeHostCountFromPlacement(c, bal.finalPlacement);
  const pheFreed = h - activeHostCountFromPlacement(c, phe.finalPlacement);
  console.log(`hosts=${h} target=${pct}% placed=${c.servers.length} load=${loadPct}% | BalCon freed=${balFreed} migs=${bal.migrations.length} | PheCon freed=${pheFreed} migs=${phe.migrations.length}`);
}
