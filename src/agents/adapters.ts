/**
 * Adapters for different agent platforms
 */

import type { Adapter, NetworkMessage } from './core/types.js';
import { InstructionGateway, type ClientInstructionEnvelope, type InstructionPacket } from '../engines/instruction-gateway.js';

export type { Adapter } from './core/types.js';

function extractInstructionPacket(message: NetworkMessage): InstructionPacket | undefined {
  const payload = message.payload as unknown as Record<string, unknown> | undefined;
  const data = payload?.data as Record<string, unknown> | undefined;
  const packet = data?.instructionPacket;
  return packet && typeof packet === 'object' ? packet as InstructionPacket : undefined;
}

function familyForAdapter(type: AdapterType): string {
  if (type === 'openclaw') return 'antigravity';
  return type;
}

abstract class RenderedInstructionAdapter implements Adapter {
  connected = false;
  agents: string[] = [];
  private gateway = new InstructionGateway(process.cwd());
  private lastEnvelope?: ClientInstructionEnvelope;

  constructor(
    public name: string,
    public type: AdapterType,
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
    console.log(`[${this.name} Adapter] Connected`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log(`[${this.name} Adapter] Disconnected`);
  }

  async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    const packet = extractInstructionPacket(message);
    if (packet) {
      this.lastEnvelope = this.gateway.renderEnvelope(packet, familyForAdapter(this.type));
      console.log(`[${this.name} Adapter] Rendered ${this.lastEnvelope.format} packet ${this.lastEnvelope.packetHash}`);
      return;
    }
    console.log(`[${this.name} Adapter] Sending generic message:`, message.type);
  }

  receive(message: NetworkMessage): void {
    console.log(`[${this.name} Adapter] Received:`, message.type);
  }

  async spawnAgent(type: string, config?: unknown): Promise<string> {
    const agentId = `${this.name}_${type}_${Date.now()}`;
    this.agents.push(agentId);
    console.log(`[${this.name} Adapter] Spawned agent: ${agentId}`);
    if (config && typeof config === 'object') {
      const maybePacket = (config as Record<string, unknown>).instructionPacket as InstructionPacket | undefined;
      if (maybePacket) {
        this.lastEnvelope = this.gateway.renderEnvelope(maybePacket, familyForAdapter(this.type));
      }
    }
    return agentId;
  }

  getLastEnvelope(): ClientInstructionEnvelope | undefined {
    return this.lastEnvelope;
  }
}

export class OpenClawAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('openclaw', 'openclaw');
  }
}

export class ClaudeCodeAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('claude-code', 'claude-code');
  }
}

export class RufloAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('ruflo', 'ruflo');
  }
}

export class CodexAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('codex', 'codex');
  }
}

export class OpencodeAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('opencode', 'opencode');
  }
}

export class CursorAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('cursor', 'cursor');
  }
}

export class WindsurfAdapter extends RenderedInstructionAdapter {
  constructor() {
    super('windsurf', 'windsurf');
  }
}

export class CustomAdapter extends RenderedInstructionAdapter {
  private sendHandler?: (message: NetworkMessage) => Promise<void>;
  private receiveHandler?: (message: NetworkMessage) => void;

  constructor(name: string) {
    super(name, 'custom');
  }

  override async send(message: NetworkMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not connected');
    }
    if (this.sendHandler) {
      await this.sendHandler(message);
      return;
    }
    await super.send(message);
  }

  override receive(message: NetworkMessage): void {
    if (this.receiveHandler) {
      this.receiveHandler(message);
      return;
    }
    super.receive(message);
  }

  setSendHandler(handler: (message: NetworkMessage) => Promise<void>): void {
    this.sendHandler = handler;
  }

  setReceiveHandler(handler: (message: NetworkMessage) => void): void {
    this.receiveHandler = handler;
  }
}

import { MCPAdapter } from './adapters/mcp.js';

export type AdapterType =
  | 'openclaw'
  | 'claude-code'
  | 'ruflo'
  | 'langchain'
  | 'autogen'
  | 'custom'
  | 'mcp'
  | 'codex'
  | 'opencode'
  | 'cursor'
  | 'windsurf';

export function createAdapter(type: AdapterType, customName?: string): Adapter {
  switch (type) {
    case 'openclaw':
      return new OpenClawAdapter();
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'ruflo':
      return new RufloAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'opencode':
      return new OpencodeAdapter();
    case 'cursor':
      return new CursorAdapter();
    case 'windsurf':
      return new WindsurfAdapter();
    case 'mcp':
      return new MCPAdapter();
    case 'custom':
      return new CustomAdapter(customName ?? 'custom');
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}
