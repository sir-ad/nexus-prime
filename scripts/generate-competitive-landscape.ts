import fs from 'node:fs';
import path from 'node:path';

type TierId = 'tier1' | 'tier2' | 'tier3';

type RepoSeed = {
  name: string;
  repo: string;
  tier: TierId;
  category: string;
  audience: string;
  orchestrationModel: string;
  executionSubstrate: string;
  memoryContextModel: string;
  operatorSurface: string;
  bestAt: string;
  tradeoff: string;
};

type TierRecord = {
  id: TierId;
  label: string;
  description: string;
};

type RepoSnapshot = RepoSeed & {
  url: string;
  stars: number;
  sources: string[];
};

const OUTPUT_PATH = path.join(process.cwd(), 'docs', 'assets', 'competitive-landscape.json');
const TIER_ORDER: TierId[] = ['tier1', 'tier2', 'tier3'];

const TIERS: TierRecord[] = [
  {
    id: 'tier1',
    label: 'Tier 1 · Direct control planes / developer orchestrators',
    description:
      'The closest group to Nexus Prime: repo-adjacent control planes and developer orchestration layers that shape how coding agents execute, verify, or collaborate.',
  },
  {
    id: 'tier2',
    label: 'Tier 2 · Broader multi-agent frameworks / platforms',
    description:
      'Multi-agent frameworks and platforms that help teams build agentic systems, but are usually broader application frameworks rather than a repo-first control plane.',
  },
  {
    id: 'tier3',
    label: 'Tier 3 · Adjacent / specialized frameworks',
    description:
      'Qualifying projects with a narrower substrate, domain, or execution posture that still overlap with multi-agent orchestration decisions.',
  },
];

const ROSTER: RepoSeed[] = [
  {
    name: 'Nexus Prime',
    repo: 'sir-ad/nexus-prime',
    tier: 'tier1',
    category: 'MCP control plane',
    audience: 'Agent builders and operator-heavy coding teams',
    orchestrationModel: 'Bootstrap-first MCP entry that routes into one orchestrator-owned execution contract',
    executionSubstrate: 'Local repo plus worktree-backed runtime and verifier lanes',
    memoryContextModel: 'Persisted memory fabric, session-first RAG gate, and source-aware token budgeting',
    operatorSurface: 'MCP, dashboard, runtime truth APIs, generated client bootstrap',
    bestAt: 'Repo-grounded coding-agent operations with runtime truth and operator visibility',
    tradeoff: 'More opinionated than lightweight scaffolds that only expose agent harnesses or SDK primitives',
  },
  {
    name: 'OpenHands',
    repo: 'OpenHands/OpenHands',
    tier: 'tier1',
    category: 'AI-driven development platform',
    audience: 'Developers who want a general autonomous software-development agent',
    orchestrationModel: 'AI-driven development agent platform for planning and executing coding tasks',
    executionSubstrate: 'Managed development runtime for browsing, coding, and tool execution',
    memoryContextModel: 'Task and session context centered on the active development run',
    operatorSurface: 'Web app, CLI, SDK, hosted and self-hosted surfaces',
    bestAt: 'General autonomous development workflows and issue-to-code execution',
    tradeoff: 'Less centered on a bootstrap-first MCP control plane for external coding clients',
  },
  {
    name: 'Ruflo',
    repo: 'ruvnet/ruflo',
    tier: 'tier1',
    category: 'Agent orchestration platform',
    audience: 'Claude and Codex teams that want packaged multi-agent coordination',
    orchestrationModel: 'Swarm-oriented orchestration platform with predefined coordination surfaces',
    executionSubstrate: 'Agent swarms, autonomous workflows, and packaged orchestration modules',
    memoryContextModel: 'RAG integration and self-learning swarm context',
    operatorSurface: 'CLI, configs, orchestrator packages, client integrations',
    bestAt: 'Packaged multi-agent coordination with strong swarm scaffolding',
    tradeoff: 'More topology-centric than a repo-first control plane with persisted runtime truth',
  },
  {
    name: 'Shannon',
    repo: 'Kocoro-lab/Shannon',
    tier: 'tier1',
    category: 'Production orchestration framework',
    audience: 'Engineering teams that want production-oriented multi-agent orchestration',
    orchestrationModel: 'Production-oriented orchestration with approval, observability, and multiple execution strategies',
    executionSubstrate: 'Framework-managed multi-agent runs and production workflow policies',
    memoryContextModel: 'Context governance and production execution state',
    operatorSurface: 'CLI, framework runtime, docs, and operational controls',
    bestAt: 'Production-minded orchestration with strong approval and observability posture',
    tradeoff: 'Less focused on MCP-first client bootstrap and dashboard-led runtime truth',
  },
  {
    name: 'Metaswarm',
    repo: 'dsifry/metaswarm',
    tier: 'tier1',
    category: 'Developer orchestration scaffold',
    audience: 'CLI power users working across Claude Code, Gemini CLI, and Codex CLI',
    orchestrationModel: 'Self-improving multi-agent orchestration scaffold with TDD and quality gates',
    executionSubstrate: 'CLI-oriented development harness and command-driven agent flows',
    memoryContextModel: 'Spec, task, and improvement-loop context',
    operatorSurface: 'CLI commands and repo-level scaffolding',
    bestAt: 'Spec and TDD-oriented multi-agent coding flows',
    tradeoff: 'Lighter runtime truth and operator surface than a fuller control plane',
  },
  {
    name: 'AssemblyZero',
    repo: 'martymcenroe/AssemblyZero',
    tier: 'tier1',
    category: 'Parameterized dev orchestrator',
    audience: 'Developers who want configurable multi-agent development routing',
    orchestrationModel: 'Parameterized multi-agent orchestration framework for coding agents',
    executionSubstrate: 'CLI-oriented harness with configurable orchestration parameters',
    memoryContextModel: 'Task and session context around the configured agent flow',
    operatorSurface: 'CLI and project configuration',
    bestAt: 'Fast configurable routing across coding agents',
    tradeoff: 'Smaller control-plane and persistence surface than Nexus Prime',
  },
  {
    name: 'multi-agent-squad',
    repo: 'bijutharakan/multi-agent-squad',
    tier: 'tier1',
    category: 'Development automation orchestrator',
    audience: 'Claude Code teams that want specialized agent squads and Git automation',
    orchestrationModel: 'Specialized multi-agent development orchestration with automated workflow steps',
    executionSubstrate: 'CLI plus Git-oriented development automation',
    memoryContextModel: 'Execution context around squad tasks and automation state',
    operatorSurface: 'CLI, repo automation, and squad scaffolding',
    bestAt: 'Claude Code-centric development automation with specialist agents',
    tradeoff: 'More toolchain-specific and narrower than a general MCP control plane',
  },
  {
    name: 'kata-orchestrator',
    repo: 'gannonh/kata-orchestrator',
    tier: 'tier1',
    category: 'Spec-driven orchestrator',
    audience: 'Spec-driven engineering teams',
    orchestrationModel: 'Agent orchestration for spec-driven development',
    executionSubstrate: 'Task and spec pipeline around coding agents',
    memoryContextModel: 'Spec, task, and workflow context',
    operatorSurface: 'CLI and workflow scripts',
    bestAt: 'Spec-driven development loops and repeatable task breakdown',
    tradeoff: 'Narrower operator surface than a broader control plane',
  },
  {
    name: 'AutoGen',
    repo: 'microsoft/autogen',
    tier: 'tier2',
    category: 'Agentic application framework',
    audience: 'Developers embedding agents into products or internal tools',
    orchestrationModel: 'Programming framework for agentic AI and multi-agent applications',
    executionSubstrate: 'SDK and framework runtime inside application code',
    memoryContextModel: 'Framework-managed conversation, state, and workflow context',
    operatorSurface: 'SDK, docs, and platform extensions',
    bestAt: 'Building agentic applications and custom multi-agent systems',
    tradeoff: 'Framework-first, so teams still assemble their own repo/runtime control plane',
  },
  {
    name: 'CrewAI',
    repo: 'crewAIInc/crewAI',
    tier: 'tier2',
    category: 'Crew-style framework',
    audience: 'Teams that want role-based autonomous agent crews',
    orchestrationModel: 'Role-playing autonomous AI agents working as crews',
    executionSubstrate: 'Framework and platform surfaces for crew execution',
    memoryContextModel: 'Agent and task context inside crew flows',
    operatorSurface: 'Framework APIs, docs, and hosted product surfaces',
    bestAt: 'Crew-style task orchestration and role-based agent collaboration',
    tradeoff: 'Less focused on runtime truth and repo-grounded coding execution',
  },
  {
    name: 'LangGraph',
    repo: 'langchain-ai/langgraph',
    tier: 'tier2',
    category: 'Graph orchestration framework',
    audience: 'Application teams building long-running stateful agents',
    orchestrationModel: 'Graph-based orchestration for resilient language agents',
    executionSubstrate: 'Stateful graph runtime inside app stacks',
    memoryContextModel: 'Checkpointed graph state and durable execution context',
    operatorSurface: 'SDK, docs, and LangGraph platform tooling',
    bestAt: 'Durable graph-based agent workflows',
    tradeoff: 'Lower-level framework that requires more assembly around operator surfaces',
  },
  {
    name: 'MetaGPT',
    repo: 'FoundationAgents/MetaGPT',
    tier: 'tier2',
    category: 'Role-specialized framework',
    audience: 'Teams exploring software-company-style agent collaboration',
    orchestrationModel: 'Multi-agent framework built around role-specialized software-company metaphors',
    executionSubstrate: 'Framework-managed agent roles and collaborative task flows',
    memoryContextModel: 'Role, artifact, and project context',
    operatorSurface: 'Framework APIs, examples, and docs',
    bestAt: 'Software-company-style multi-agent collaboration',
    tradeoff: 'Heavier role topology and less control-plane discipline for external coding clients',
  },
  {
    name: 'CAMEL',
    repo: 'camel-ai/camel',
    tier: 'tier2',
    category: 'Multi-agent research and framework stack',
    audience: 'Researchers and builders exploring large-scale agent systems',
    orchestrationModel: 'Multi-agent framework oriented around large-scale agent experimentation',
    executionSubstrate: 'SDK, framework runtime, and research-oriented modules',
    memoryContextModel: 'Agent memory and task state patterns inside the framework',
    operatorSurface: 'Docs, SDK, and experimentation surfaces',
    bestAt: 'Broad multi-agent experimentation and scaling work',
    tradeoff: 'Less opinionated about repo-grounded runtime operations',
  },
  {
    name: 'Agency Swarm',
    repo: 'VRSEN/agency-swarm',
    tier: 'tier2',
    category: 'Agency-style orchestration framework',
    audience: 'Teams wanting reliable multi-agent orchestration around agency patterns',
    orchestrationModel: 'Reliable multi-agent orchestration with structured agency communication',
    executionSubstrate: 'Framework runtime and agent communication flows',
    memoryContextModel: 'Agent thread and task context',
    operatorSurface: 'Python framework and docs',
    bestAt: 'Structured agency patterns and directed agent collaboration',
    tradeoff: 'Less local-first runtime truth and client bootstrap surface',
  },
  {
    name: 'Swarms',
    repo: 'kyegomez/swarms',
    tier: 'tier2',
    category: 'Enterprise multi-agent framework',
    audience: 'Teams wanting a broad multi-agent orchestration surface',
    orchestrationModel: 'Enterprise-grade production-ready multi-agent orchestration framework',
    executionSubstrate: 'Framework runtime across multiple agent orchestration modes',
    memoryContextModel: 'Framework-managed agent state and orchestration context',
    operatorSurface: 'SDK, docs, and product ecosystem',
    bestAt: 'Broad orchestration coverage and flexible swarm patterns',
    tradeoff: 'Breadth over the tighter repo-first discipline of a control plane',
  },
  {
    name: 'BotSharp',
    repo: 'SciSharp/BotSharp',
    tier: 'tier2',
    category: '.NET multi-agent framework',
    audience: '.NET teams building AI agents and multi-agent systems',
    orchestrationModel: 'AI multi-agent framework in .NET',
    executionSubstrate: '.NET runtime and framework stack',
    memoryContextModel: 'Bot, task, and application context',
    operatorSurface: '.NET SDK, docs, and service surfaces',
    bestAt: '.NET-native agent systems and multi-agent applications',
    tradeoff: 'Different stack and fewer repo-first MCP surfaces',
  },
  {
    name: 'agentUniverse',
    repo: 'agentuniverse-ai/agentUniverse',
    tier: 'tier2',
    category: 'Application framework',
    audience: 'Developers who want to build multi-agent apps quickly',
    orchestrationModel: 'LLM multi-agent framework for building applications',
    executionSubstrate: 'Framework runtime and application-building toolkit',
    memoryContextModel: 'App and agent context inside the framework',
    operatorSurface: 'Framework APIs and docs',
    bestAt: 'Quick multi-agent application assembly',
    tradeoff: 'Less operator-facing runtime truth than Nexus Prime',
  },
  {
    name: 'LLMStack',
    repo: 'trypromptly/LLMStack',
    tier: 'tier2',
    category: 'No-code platform',
    audience: 'Teams building agent workflows and apps without heavy code investment',
    orchestrationModel: 'No-code multi-agent framework for workflows and applications',
    executionSubstrate: 'Platform and workflow builder with data integration',
    memoryContextModel: 'App and data context managed by the platform',
    operatorSurface: 'Web platform, docs, and hosted workflows',
    bestAt: 'No-code and low-code agent workflows with business data',
    tradeoff: 'Less repo-grounded developer control-plane depth',
  },
  {
    name: 'ChatDev',
    repo: 'OpenBMB/ChatDev',
    tier: 'tier2',
    category: 'Multi-agent collaboration platform',
    audience: 'Teams exploring collaborative multi-agent software work',
    orchestrationModel: 'LLM-powered multi-agent collaboration for software tasks',
    executionSubstrate: 'Framework and platform surfaces for collaborative agent work',
    memoryContextModel: 'Project and artifact context across collaborating agents',
    operatorSurface: 'Framework, docs, and platform positioning',
    bestAt: 'Collaborative software-agent experiments and workflows',
    tradeoff: 'Less focused on a local-first control plane for external coding clients',
  },
  {
    name: 'Snowflake Orchestration Framework',
    repo: 'Snowflake-Labs/orchestration-framework',
    tier: 'tier3',
    category: 'Snowflake-native framework',
    audience: 'Snowflake teams building agents around Snowflake services',
    orchestrationModel: 'Multi-agent framework with native Snowflake support',
    executionSubstrate: 'Snowflake-native services and orchestration stack',
    memoryContextModel: 'Snowflake data and execution context',
    operatorSurface: 'Framework docs and Snowflake-oriented integration points',
    bestAt: 'Agent systems that live close to Snowflake',
    tradeoff: 'Much narrower substrate than a general coding-agent control plane',
  },
  {
    name: 'AIEvo',
    repo: 'antgroup/aievo',
    tier: 'tier3',
    category: 'Application framework',
    audience: 'Developers building multi-agent apps in the Ant ecosystem',
    orchestrationModel: 'Multi-agent framework for creating multi-agent applications',
    executionSubstrate: 'Framework runtime and application-building toolkit',
    memoryContextModel: 'Application-level task and agent context',
    operatorSurface: 'Framework docs and repo-level examples',
    bestAt: 'General multi-agent app construction in that ecosystem',
    tradeoff: 'Smaller community and less operator surface than larger frameworks',
  },
  {
    name: 'ContextAgent',
    repo: 'context-machine-lab/ContextAgent',
    tier: 'tier3',
    category: 'Context-centric framework',
    audience: 'Builders who want a context-central multi-agent API',
    orchestrationModel: 'Context-central multi-agent framework with a PyTorch-like API',
    executionSubstrate: 'SDK and framework runtime for context-centric systems',
    memoryContextModel: 'Central context model as the coordination layer',
    operatorSurface: 'SDK, docs, and examples',
    bestAt: 'Context-centric agent composition',
    tradeoff: 'Less opinionated about runtime operations and developer control planes',
  },
  {
    name: 'Yacana',
    repo: 'rememberSoftwares/yacana',
    tier: 'tier3',
    category: 'Task-driven building blocks',
    audience: 'Builders who want task-driven multi-agent primitives',
    orchestrationModel: 'Task-driven LLM multi-agent building blocks',
    executionSubstrate: 'Framework primitives and composable orchestration blocks',
    memoryContextModel: 'Task-driven context within the framework',
    operatorSurface: 'Framework docs and examples',
    bestAt: 'Composable multi-agent primitives',
    tradeoff: 'More building blocks and fewer operator-facing control-plane surfaces',
  },
  {
    name: 'Arbiter',
    repo: 'harnesslabs/arbiter',
    tier: 'tier3',
    category: 'Simulation and auditing framework',
    audience: 'Teams focused on design, simulation, and auditing use cases',
    orchestrationModel: 'Multi-agent framework for design, simulation, and auditing',
    executionSubstrate: 'Framework runtime for evaluation-heavy agent flows',
    memoryContextModel: 'Simulation and audit context',
    operatorSurface: 'Framework docs and task-oriented surfaces',
    bestAt: 'Design, simulation, and audit-heavy scenarios',
    tradeoff: 'More specialized than a general coding-agent control plane',
  },
  {
    name: 'nexus-agents',
    repo: '0xstely/nexus-agents',
    tier: 'tier3',
    category: 'Distributed multimodal framework',
    audience: 'Builders who want distributed multimodal agent orchestration',
    orchestrationModel: 'Distributed multi-modal agent orchestration in a microservices architecture',
    executionSubstrate: 'Microservices-based orchestration across multimodal services',
    memoryContextModel: 'Distributed processing state across services',
    operatorSurface: 'Repo docs and microservice-oriented configuration',
    bestAt: 'Distributed multimodal pipelines',
    tradeoff: 'Different problem shape than a repo-grounded MCP control plane',
  },
];

function tierRank(id: TierId): number {
  return TIER_ORDER.indexOf(id);
}

async function fetchGitHubRepo(repo: string): Promise<{ stars: number; url: string; homepageUrl: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nexus-prime-competitive-landscape',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub metadata fetch failed for ${repo}: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as { stargazers_count: number; html_url: string; homepage?: string | null };
  return {
    stars: payload.stargazers_count,
    url: payload.html_url,
    homepageUrl: payload.homepage || '',
  };
}

async function buildSnapshot(): Promise<{ snapshotDate: string; inclusionRule: string; tiers: TierRecord[]; repos: RepoSnapshot[] }> {
  const repos = await Promise.all(ROSTER.map(async (seed) => {
    const github = await fetchGitHubRepo(seed.repo);
    const sources = [github.url];
    if (github.homepageUrl) {
      sources.push(github.homepageUrl);
    } else {
      sources.push(`${github.url}#readme`);
    }
    const snapshot: RepoSnapshot = {
      ...seed,
      stars: github.stars,
      url: github.url,
      sources,
    };
    return snapshot;
  }));

  repos.sort((left, right) => {
    const tierDiff = tierRank(left.tier) - tierRank(right.tier);
    if (tierDiff !== 0) return tierDiff;
    return right.stars - left.stars;
  });

  return {
    snapshotDate: new Date().toISOString().slice(0, 10),
    inclusionRule:
      'Includes open-source multi-agent frameworks, orchestration platforms, and control planes with at least 50 GitHub stars at snapshot time. Nexus Prime is included as the focal baseline even though the star threshold applies to the comparison set rather than the product being evaluated.',
    tiers: TIERS,
    repos,
  };
}

async function main(): Promise<void> {
  const snapshot = await buildSnapshot();
  if (process.argv.includes('--stdout')) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

await main();
