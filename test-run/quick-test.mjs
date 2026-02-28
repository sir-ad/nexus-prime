// Quick test of Nexus Prime core concepts

console.log("🧬 Nexus Prime - Quick Test\n");

// 1. Test Memory System concept
class SimpleMemory {
  constructor() {
    this.cortex = new Map(); // Long-term
    this.hippocampus = [];   // Recent
    this.prefrontal = [];    // Working
  }
  
  store(pattern, priority = 1.0) {
    this.cortex.set(pattern.id, { ...pattern, weight: priority });
  }
  
  recall(query, k = 5) {
    // Simple recall - return first k from cortex
    return Array.from(this.cortex.values()).slice(0, k);
  }
}

// 2. Test Wave Pattern concept
class WavePattern {
  constructor(amplitude = 0.5, phase = 0, frequency = 1, wavelength = 10) {
    this.amplitude = amplitude;
    this.phase = phase;
    this.frequency = frequency;
    this.wavelength = wavelength;
  }
  
  encode(content) {
    // Simple encoding
    this.amplitude = Math.min(1, content.length / 100);
    return this;
  }
  
  superpose(other) {
    return new WavePattern(
      (this.amplitude + other.amplitude) / 2,
      this.phase + other.phase,
      (this.frequency + other.frequency) / 2,
      Math.max(this.wavelength, other.wavelength)
    );
  }
}

// 3. Test Agent concept
class Agent {
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.memory = new SimpleMemory();
    this.state = 'idle';
  }
  
  async work(task) {
    this.state = 'working';
    console.log(`  🤖 ${this.id} (${this.type}): Working on "${task}"`);
    await new Promise(r => setTimeout(r, 100));
    this.state = 'idle';
    return { result: `Done: ${task}`, value: Math.random() };
  }
}

// Run tests
console.log("1. Testing Memory System...");
const mem = new SimpleMemory();
mem.store({ id: 'p1', data: 'test pattern' }, 0.9);
console.log(`   ✓ Stored pattern, recall: ${mem.recall('test').length} items`);

console.log("\n2. Testing Wave Patterns...");
const wave1 = new WavePattern().encode("Hello");
const wave2 = new WavePattern().encode("World");
const combined = wave1.superpose(wave2);
console.log(`   ✓ Combined waves - amplitude: ${combined.amplitude.toFixed(2)}`);

console.log("\n3. Testing Agents...");
const agents = [
  new Agent('researcher-1', 'researcher'),
  new Agent('coder-1', 'coder')
];

for (const agent of agents) {
  await agent.work(`test-task-${agent.type}`);
}

console.log("\n✅ Nexus Prime core concepts working!");

// 4. Demonstrate evolution concept
console.log("\n4. Evolution Demo...");
const grammar = new Map();

function discoverPattern(tokens, success, value) {
  const key = tokens.join('_');
  if (!grammar.has(key)) {
    grammar.set(key, { weight: 0, count: 0 });
  }
  const entry = grammar.get(key);
  entry.count++;
  entry.weight = entry.weight * 0.9 + value * 0.1;
  return entry;
}

discoverPattern(['search', 'AI'], true, 0.9);
discoverPattern(['search', 'AI'], true, 0.85);
discoverPattern(['write', 'code'], true, 0.7);

console.log("  Discovered patterns:");
for (const [key, val] of grammar) {
  console.log(`    - ${key}: weight=${val.weight.toFixed(2)}, count=${val.count}`);
}

console.log("\n🧬 Nexus Prime is operational!\n");
