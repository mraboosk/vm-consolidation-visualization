// Inline test of the BalCon algorithm extracted from index.html
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

function runBalCon(initial) {
  const state = { ...initial, placement: { ...initial.placement } };
  const migrations = [];
  let step = 0;
  let progress = true;
  let safety = 0;
  while (progress && safety++ < 100) {
    progress = false;
    const loads = computeHostLoads(state);
    const nonEmpty = state.hosts
      .filter(h => loads[h.id].servers.length > 0)
      .sort((a, b) => (loads[a.id].cpu + loads[a.id].ram) - (loads[b.id].cpu + loads[b.id].ram));
    for (const donor of nonEmpty) {
      const donorServers = loads[donor.id].servers.slice()
        .sort((a, b) => (b.cpu + b.ram) - (a.cpu + a.ram));
      const trial = { ...state.placement };
      const trialLoads = {};
      for (const h of state.hosts) trialLoads[h.id] = { cpu: loads[h.id].cpu, ram: loads[h.id].ram };
      trialLoads[donor.id] = { cpu: 0, ram: 0 };
      let failed = false;
      for (const s of donorServers) {
        const cands = state.hosts.filter(h => h.id !== donor.id && loads[h.id].servers.length > 0)
          .map(h => ({
            h,
            slack: Math.min(h.capCPU - trialLoads[h.id].cpu - s.cpu, h.capRAM - trialLoads[h.id].ram - s.ram),
          }))
          .filter(c => c.slack >= 0)
          .sort((a, b) => a.slack - b.slack);
        if (cands.length === 0) { failed = true; break; }
        const target = cands[0].h;
        trial[s.id] = target.id;
        trialLoads[target.id].cpu += s.cpu;
        trialLoads[target.id].ram += s.ram;
      }
      if (failed) continue;
      for (const s of donorServers) {
        migrations.push({ serverId: s.id, from: donor.id, to: trial[s.id], step: step++ });
        state.placement[s.id] = trial[s.id];
      }
      progress = true;
      break;
    }
  }
  return { finalPlacement: state.placement, migrations };
}

for (let s = 1; s <= 8; s++) {
  const seed = s * 1234;
  const c = generateCluster(seed);
  const baseFreed = HOST_COUNT - activeHostCount(c);
  const bal = runBalCon(c);
  const balFreed = HOST_COUNT - activeHostCountFromPlacement(c, bal.finalPlacement);
  console.log(
    `seed=${seed} servers=${c.servers.length} base.freed=${baseFreed} | ` +
    `BalCon freed=${balFreed} migs=${bal.migrations.length}`
  );
}
