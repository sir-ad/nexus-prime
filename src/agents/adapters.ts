/**
 * Adapters for different agent platforms
 */

import { Adapter, NetworkMessage, Agent } from './core/types';

export { Adapter } from './core/types';
export class OpenClawAdapter implements Adapter {
  name = 'openclaw';
  type = 'openclaw' as const;
  connected = false;
  agents: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    console.log('[OpenClaw Adapter] Connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('[OpenClaw Adapter] Disconnected');
  }

  async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    console.log('[OpenClaw Adapter] Sending:', message);
  }

  receive(message: NetworkMessage): void {
    console.log('[OpenClaw Adapter] Received:', message);
  }

  async spawnAgent(type: string, config?: unknown): Promise<string> {
    const agentId = `openclaw_${type}_${Date.now()}`;
    this.agents.push(agentId);
    console.log(`[OpenClaw Adapter] Spawned agent: ${agentId}`);
    return agentId;
  }
}

export class ClaudeCodeAdapter implements Adapter {
  name = 'claude-code';
  type = 'claude-code' as const;
  connected = false;
  agents: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    console.log('[Claude Code Adapter] Connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('[Claude Code Adapter] Disconnected');
  }

  async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    console.log('[Claude Code Adapter] Sending:', message);
  }

  receive(message: NetworkMessage): void {
    console.log('[Claude Code Adapter] Received:', message);
  }

  async spawnAgent(type: string, config?: unknown): Promise<string> {
    const agentId = `claude_${type}_${Date.now()}`;
    this.agents.push(agentId);
    console.log(`[Claude Code Adapter] Spawned agent: ${agentId}`);
    return agentId;
  }
}

export class RufloAdapter implements Adapter {
  name = 'ruflo';
  type = 'ruflo' as const;
  connected = false;
  agents: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    console.log('[Ruflo Adapter] Connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('[Ruflo Adapter] Disconnected');
  }

  async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    console.log('[Ruflo Adapter] Sending:', message);
  }

  receive(message: NetworkMessage): void {
    console.log('[Ruflo Adapter] Received:', message);
  }

  async spawnAgent(type: string, config?: unknown): Promise<string> {
    const agentId = `ruflo_${type}_${Date.now()}`;
    this.agents.push(agentId);
    console.log(`[Ruflo Adapter] Spawned agent: ${agentId}`);
    return agentId;
  }
}

export class CustomAdapter implements Adapter {
  name: string;
  type = 'custom' as const;
  connected = false;
  agents: string[] = [];

  private sendHandler?: (message: NetworkMessage) => Promise<void>;
  private receiveHandler?: (message: NetworkMessage) => void;

  constructor(name: string) {
    this.name = name;
  }

  async connect(): Promise<void> {
    this.connected = true;
    console.log(`[Custom Adapter: ${this.name}] Connected`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log(`[Custom Adapter: ${this.name}] Disconnected`);
  }

  async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    if (this.sendHandler) {
      await this.sendHandler(message);
    }
  }

  receive(message: NetworkMessage): void {
    if (this.receiveHandler) {
      this.receiveHandler(message);
    }
  }

  setSendHandler(handler: (message: NetworkMessage) => Promise<void>): void {
    this.sendHandler = handler;
  }

  setReceiveHandler(handler: (message: NetworkMessage) => void): void {
    this.receiveHandler = handler;
  }

  async spawnAgent(type: string, config?: unknown): Promise<string> {
    const agentId = `${this.name}_${type}_${Date.now()}`;
    this.agents.push(agentId);
    return agentId;
  }
}

import { MCPAdapter } from './adapters/mcp.js';

// ==================== ADAPTER FACTORY ====================

export type AdapterType = 'openclaw' | 'claude-code' | 'ruflo' | 'langchain' | 'autogen' | 'custom' | 'mcp';

export function createAdapter(type: AdapterType, customName?: string): Adapter {
  switch (type) {
    case 'openclaw':
      return new OpenClawAdapter();
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'ruflo':
      return new RufloAdapter();
    case 'mcp':
      return new MCPAdapter();
    case 'custom':
      return new CustomAdapter(customName ?? 'custom');
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}
