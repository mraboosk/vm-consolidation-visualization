// Inline test of the Custom algorithm extracted from index.html
const HOST_COUNT = 10;
const { HOST_CPU, HOST_RAM, INSTANCE_TYPES } = require('./constants.js');

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randInt(rng, lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }

function generateCluster(seed) {
  const rng = mulberry32(seed);
  const hosts = Array.from({ length: HOST_COUNT }, (_, i) => ({
    id: 'h' + i, idx: i, capCPU: HOST_CPU, capRAM: HOST_RAM,
  }));
  const serverCount = randInt(rng, 24, 30);
  const servers = [];
  for (let i = 0; i < serverCount; i++) {
    const t = INSTANCE_TYPES[Math.floor(rng() * INSTANCE_TYPES.length)];
    servers.push({ id: 's' + i, type: t.name, cpu: t.cpu, ram: t.cpu * 2, hue: 0 });
  }
  const placement = {};
  const load = hosts.map(() => ({ cpu: 0, ram: 0 }));
  const order = [...servers].sort(() => rng() - 0.5);
  const targets = hosts.map(() => randInt(rng, 25, 85));
  for (const s of order) {
    const cands = hosts
      .map((h, i) => ({ h, i }))
      .filter(c => c.h.capCPU - load[c.i].cpu >= s.cpu && c.h.capRAM - load[c.i].ram >= s.ram);
    if (cands.length === 0) continue;
    const under = cands.filter(c => load[c.i].cpu < targets[c.i]);
    const pool = under.length > 0 ? under : cands;
    pool.sort((a, b) => (load[b.i].cpu + load[b.i].ram) - (load[a.i].cpu + load[a.i].ram));
    const pickIdx = rng() < 0.7 ? 0 : Math.min(pool.length - 1, Math.floor(rng() * Math.min(3, pool.length)));
    const pick = pool[pickIdx];
    placement[s.id] = pick.h.id;
    load[pick.i].cpu += s.cpu;
    load[pick.i].ram += s.ram;
  }
  const placedServers = servers.filter(s => placement[s.id]);
  return { hosts, servers: placedServers, placement, seed };
}

function computeHostLoads(state) {
  const loads = {};
  for (const h of state.hosts) loads[h.id] = { cpu: 0, ram: 0, servers: [] };
  for (const s of state.servers) {
    const hid = state.placement[s.id];
    if (!hid) continue;
    loads[hid].cpu += s.cpu;
    loads[hid].ram += s.ram;
    loads[hid].servers.push(s);
  }
  return loads;
}
function activeHostCount(state) {
  const loads = computeHostLoads(state);
  return state.hosts.filter(h => loads[h.id].servers.length > 0).length;
}
function activeHostCountFromPlacement(state, placement) {
  const counts = {};
  for (const h of state.hosts) counts[h.id] = 0;
  for (const s of state.servers) {
    const hid = placement[s.id];
    if (hid) counts[hid]++;
  }
  return state.hosts.filter(h => counts[h.id] > 0).length;
}

// Custom: pick the active host with the most free CPU (lightest donor) and try
// to fully evacuate it. Each of its servers goes onto the active host with the
// least free CPU that still fits (best-fit). Only commit if every server can be
// relocated — a partial move wouldn't free the host. If it can't be emptied,
// skip it and move on to the next-most-free host.
function runCustom(initial) {
  const state = { ...initial, placement: { ...initial.placement } };
  const migrations = [];
  let step = 0;
  const skip = new Set();
  while (true) {
    const loads = computeHostLoads(state);
    const active = state.hosts.filter(h => loads[h.id].servers.length > 0 && !skip.has(h.id));
    if (active.length <= 1) break;
    active.sort((a, b) => (b.capCPU - loads[b.id].cpu) - (a.capCPU - loads[a.id].cpu));
    const donor = active[0];

    const trialLoads = {};
    for (const h of state.hosts) trialLoads[h.id] = { cpu: loads[h.id].cpu, ram: loads[h.id].ram };
    const moves = [];
    let placedAll = true;
    for (const s of loads[donor.id].servers) {
      const cands = state.hosts
        .filter(h => h.id !== donor.id && loads[h.id].servers.length > 0)
        .map(h => ({ h, freeCPU: h.capCPU - trialLoads[h.id].cpu, freeRAM: h.capRAM - trialLoads[h.id].ram }))
        .filter(c => c.freeCPU >= s.cpu && c.freeRAM >= s.ram)
        .sort((a, b) => a.freeCPU - b.freeCPU);
      if (cands.length === 0) { placedAll = false; break; }
      const target = cands[0].h;
      trialLoads[target.id].cpu += s.cpu;
      trialLoads[target.id].ram += s.ram;
      moves.push({ serverId: s.id, from: donor.id, to: target.id });
    }

    if (placedAll && moves.length > 0) {
      for (const m of moves) {
        migrations.push({ serverId: m.serverId, from: m.from, to: m.to, step: step++ });
        state.placement[m.serverId] = m.to;
      }
    } else {
      skip.add(donor.id);
    }
  }
  return { finalPlacement: state.placement, migrations };
}

// Replay migrations in order from the initial placement, checking at each step
// that the target host is active (consolidation rule) and capacity never
// overflows. Returns the list of violations found.
function validate(c, result) {
  const errs = [];
  const place = { ...c.placement };
  const byId = {}; for (const s of c.servers) byId[s.id] = s;
  const load = {}; for (const h of c.hosts) load[h.id] = { cpu: 0, ram: 0, count: 0 };
  for (const s of c.servers) {
    const hid = place[s.id];
    if (hid) { load[hid].cpu += s.cpu; load[hid].ram += s.ram; load[hid].count++; }
  }
  const capOf = id => c.hosts.find(h => h.id === id);
  for (const m of result.migrations) {
    const s = byId[m.serverId];
    if (place[s.id] !== m.from) errs.push(`mig ${s.id}: from ${m.from} != current ${place[s.id]}`);
    if (load[m.to].count === 0) errs.push(`mig ${s.id}: target ${m.to} is empty (anti-consolidation)`);
    const cap = capOf(m.to);
    if (load[m.to].cpu + s.cpu > cap.capCPU || load[m.to].ram + s.ram > cap.capRAM) {
      errs.push(`mig ${s.id}: target ${m.to} overflow`);
    }
    load[m.from].cpu -= s.cpu; load[m.from].ram -= s.ram; load[m.from].count--;
    load[m.to].cpu += s.cpu; load[m.to].ram += s.ram; load[m.to].count++;
    place[s.id] = m.to;
  }
  // Replayed placement must match the reported finalPlacement.
  for (const s of c.servers) {
    if (place[s.id] !== result.finalPlacement[s.id]) {
      errs.push(`final mismatch ${s.id}: replay ${place[s.id]} != reported ${result.finalPlacement[s.id]}`);
    }
  }
  return errs;
}

let allOk = true;
for (let s = 1; s <= 8; s++) {
  const seed = s * 1234;
  const c = generateCluster(seed);
  const baseFreed = HOST_COUNT - activeHostCount(c);
  const cus = runCustom(c);
  const cusFreed = HOST_COUNT - activeHostCountFromPlacement(c, cus.finalPlacement);

  const errs = validate(c, cus);
  const freedOk = cusFreed >= baseFreed; // consolidation must not lose freed hosts
  const ok = errs.length === 0 && freedOk;
  if (!ok) allOk = false;

  console.log(
    `seed=${seed} servers=${c.servers.length} base.freed=${baseFreed} | ` +
    `Custom freed=${cusFreed} (+${cusFreed - baseFreed}) migs=${cus.migrations.length} ${ok ? 'OK' : 'FAIL'}`
  );
  for (const e of errs) console.log(`    ✗ ${e}`);
}
console.log(allOk ? '\nAll seeds OK' : '\nFAILURES present');
