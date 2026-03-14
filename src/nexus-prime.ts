/**
 * Nexus Prime - Local-first MCP control plane for coding agents.
 *
 * @module nexus-prime
 */

export { NexusPrime, createNexusPrime } from './index.js';
export * from './core/types.js';
export * from './core/wave.js';
export * from './core/memory.js';
export * from './core/evolution.js';
export * from './core/optimize.js';
export * from './agents/coordinator.js';
export { AdapterType, createAdapter } from './agents/adapters.js';
export * from './config.js';
