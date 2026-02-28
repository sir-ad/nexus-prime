/**
 * Nexus Prime - The Self-Evolving Agent Operating System
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
export * from './agents/adapters.js';
export * from './config.js';

// Re-export CLI as well
export { default as cli } from './cli.js';
