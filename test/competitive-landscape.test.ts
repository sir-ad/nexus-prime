import assert from 'assert';
import fs from 'fs';
import path from 'path';

type TierId = 'tier1' | 'tier2' | 'tier3';

type RepoEntry = {
  name: string;
  repo: string;
  url: string;
  stars: number;
  tier: TierId;
  category: string;
  audience: string;
  orchestrationModel: string;
  executionSubstrate: string;
  memoryContextModel: string;
  operatorSurface: string;
  bestAt: string;
  tradeoff: string;
  sources: string[];
};

type Snapshot = {
  snapshotDate: string;
  inclusionRule: string;
  tiers: Array<{ id: TierId; label: string; description: string }>;
  repos: RepoEntry[];
};

const TIER_ORDER: TierId[] = ['tier1', 'tier2', 'tier3'];
const EXPECTED_REPOS = [
  'sir-ad/nexus-prime',
  'OpenHands/OpenHands',
  'ruvnet/ruflo',
  'Kocoro-lab/Shannon',
  'dsifry/metaswarm',
  'martymcenroe/AssemblyZero',
  'bijutharakan/multi-agent-squad',
  'gannonh/kata-orchestrator',
  'microsoft/autogen',
  'crewAIInc/crewAI',
  'langchain-ai/langgraph',
  'FoundationAgents/MetaGPT',
  'camel-ai/camel',
  'VRSEN/agency-swarm',
  'kyegomez/swarms',
  'SciSharp/BotSharp',
  'agentuniverse-ai/agentUniverse',
  'trypromptly/LLMStack',
  'OpenBMB/ChatDev',
  'Snowflake-Labs/orchestration-framework',
  'antgroup/aievo',
  'context-machine-lab/ContextAgent',
  'rememberSoftwares/yacana',
  'harnesslabs/arbiter',
  '0xstely/nexus-agents',
];

function test() {
  console.log('🧪 Testing competitive landscape snapshot...\n');

  const snapshotPath = path.join(process.cwd(), 'docs', 'assets', 'competitive-landscape.json');
  const comparisonPath = path.join(process.cwd(), 'docs', 'comparison.html');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Snapshot;
  const comparisonHtml = fs.readFileSync(comparisonPath, 'utf8');

  assert.ok(snapshot.snapshotDate, 'snapshot should declare a snapshot date');
  assert.ok(snapshot.inclusionRule.includes('50 GitHub stars'), 'snapshot should explain the inclusion threshold');
  assert.strictEqual(snapshot.tiers.length, 3, 'snapshot should declare three tiers');
  assert.deepStrictEqual(snapshot.repos.map((repo) => repo.repo).sort(), EXPECTED_REPOS.slice().sort(), 'snapshot should keep the locked comparison roster');

  for (const repo of snapshot.repos) {
    if (repo.repo !== 'sir-ad/nexus-prime') {
      assert.ok(repo.stars >= 50, `${repo.repo} should meet the star threshold`);
    }
    assert.ok(repo.url.startsWith('https://github.com/'), `${repo.repo} should use the official repo URL`);
    assert.ok(Array.isArray(repo.sources) && repo.sources.length >= 1, `${repo.repo} should include at least one official source`);
    assert.ok(repo.audience.length > 0, `${repo.repo} should include an audience summary`);
    assert.ok(repo.orchestrationModel.length > 0, `${repo.repo} should include an orchestration summary`);
  }

  for (let index = 1; index < snapshot.repos.length; index += 1) {
    const previous = snapshot.repos[index - 1];
    const current = snapshot.repos[index];
    const previousTier = TIER_ORDER.indexOf(previous.tier);
    const currentTier = TIER_ORDER.indexOf(current.tier);
    assert.ok(previousTier <= currentTier, 'repos should be sorted by tier order');
    if (previous.tier === current.tier) {
      assert.ok(previous.stars >= current.stars, 'repos should be sorted by stars descending within a tier');
    }
  }

  const nexus = snapshot.repos.find((repo) => repo.repo === 'sir-ad/nexus-prime');
  assert.ok(nexus, 'snapshot should include Nexus Prime as the focal baseline');
  assert.ok(nexus?.orchestrationModel.includes('Bootstrap-first MCP entry'), 'Nexus row should emphasize the bootstrap-first control plane');

  assert.ok(comparisonHtml.includes('./assets/competitive-landscape.json'), 'comparison page should load the checked-in snapshot asset');
  assert.ok(comparisonHtml.includes('How Nexus Prime differs from other multi-agent control planes and frameworks'), 'comparison page should expose the intended hero');
  assert.ok(comparisonHtml.includes('Choose X when...'), 'comparison page should include the decision guide');

  console.log('✅ Competitive landscape snapshot and page wiring look correct\n');
}

test();
