// Shared cluster constants — used by index.html (browser) and the test-*.js scripts (Node).
// Loaded as a classic script in the browser (exposes globals) and via require() in Node.
const HOST_CPU = 100;
const HOST_RAM = 200;

const INSTANCE_TYPES = [
  { name: 'c1d10-24', cpu: 24 }, { name: 'c1d10-48', cpu: 48 },
  { name: 'c1d15-16', cpu: 16 }, { name: 'c1d15-2',  cpu: 2  },
  { name: 'c1d15-4',  cpu: 4  }, { name: 'c1d15-8',  cpu: 8  },
  { name: 'c1d20-24', cpu: 24 }, { name: 'c1d20-48', cpu: 48 },
  { name: 'c1d3-16',  cpu: 16 }, { name: 'c1d3-32',  cpu: 32 },
  { name: 'c1d30-1',  cpu: 1  }, { name: 'c1d30-16', cpu: 16 },
  { name: 'c1d30-2',  cpu: 2  }, { name: 'c1d30-24', cpu: 24 },
  { name: 'c1d30-4',  cpu: 4  }, { name: 'c1d30-48', cpu: 48 },
  { name: 'c1d30-8',  cpu: 8  }, { name: 'c1d5-24',  cpu: 24 },
  { name: 'c1d60-1',  cpu: 1  }, { name: 'c1d7-16',  cpu: 16 },
  { name: 'c1d7-4',   cpu: 4  }, { name: 'c1d7-8',   cpu: 8  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOST_CPU, HOST_RAM, INSTANCE_TYPES };
}
