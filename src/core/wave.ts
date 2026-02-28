/**
 * Wave-Pattern Communication
 * 
 * Instead of discrete tokens, agents communicate through oscillatory patterns.
 * Inspired by neural oscillations in the brain.
 */

import { WavePattern } from './types.js';

export class WaveEncoder {
  /**
   * Encode semantic content into a wave pattern
   */
  encode(
    content: string,
    importance: number = 0.5,
    emotion: number = 0,
    urgency: number = 0.5,
    depth: number = 0.5
  ): WavePattern {
    // Use content hash for deterministic encoding
    const hash = this.hashString(content);
    
    return {
      amplitude: this.normalize(importance + (hash % 100) / 200, 0, 1),
      phase: this.normalize(emotion + (hash % 628) / 100, -Math.PI, Math.PI),
      frequency: this.normalize(urgency * 10, 0.1, 10),
      wavelength: this.normalize(depth * 100, 1, 100)
    };
  }

  /**
   * Decode a wave pattern back to semantic metadata
   */
  decode(wave: WavePattern): {
    importance: number;
    emotion: number;
    urgency: number;
    depth: number;
  } {
    return {
      importance: wave.amplitude,
      emotion: wave.phase,
      urgency: wave.frequency / 10,
      depth: wave.wavelength / 100
    };
  }

  /**
   * Superpose multiple wave patterns
   * Quantum-inspired: multiple meanings can coexist until observed
   */
  superpose(waves: WavePattern[]): WavePattern {
    if (waves.length === 0) {
      return { amplitude: 0, phase: 0, frequency: 0, wavelength: 0 };
    }

    if (waves.length === 1) {
      return waves[0];
    }

    // Average amplitudes (constructive interference)
    const avgAmplitude = waves.reduce((sum, w) => sum + w.amplitude, 0) / waves.length;
    
    // Combine phases (weighted by amplitude)
    const weightedPhase = waves.reduce((sum, w) => sum + w.phase * w.amplitude, 0) / waves.length;
    
    // Average frequency
    const avgFrequency = waves.reduce((sum, w) => sum + w.frequency, 0) / waves.length;
    
    // Max wavelength (deeper meaning wins)
    const maxWavelength = Math.max(...waves.map(w => w.wavelength));

    return {
      amplitude: avgAmplitude,
      phase: weightedPhase,
      frequency: avgFrequency,
      wavelength: maxWavelength
    };
  }

  /**
   * Measure interference between two wave patterns
   */
  interference(a: WavePattern, b: WavePattern): number {
    // Calculate phase difference
    const phaseDiff = Math.abs(a.phase - b.phase);
    
    // Constructive if phases are similar, destructive if opposite
    const phaseAlignment = Math.cos(phaseDiff);
    
    // Amplitude similarity
    const amplitudeDiff = Math.abs(a.amplitude - b.amplitude);
    const amplitudeSimilarity = 1 - amplitudeDiff;
    
    // Combined interference score (-1 to 1)
    return phaseAlignment * amplitudeSimilarity;
  }

  /**
   * Convert wave to Fourier-compatible representation
   */
  toFourier(wave: WavePattern): {
    real: number;
    imag: number;
    frequency: number;
  } {
    return {
      real: wave.amplitude * Math.cos(wave.phase),
      imag: wave.amplitude * Math.sin(wave.phase),
      frequency: wave.frequency
    };
  }

  /**
   * Create wave from Fourier representation
   */
  fromFourier(real: number, imag: number, frequency: number): WavePattern {
    return {
      amplitude: Math.sqrt(real * real + imag * imag),
      phase: Math.atan2(imag, real),
      frequency: frequency,
      wavelength: 10 / frequency // Inverse relationship
    };
  }

  /**
   * Serialize wave for network transmission
   */
  serialize(wave: WavePattern): string {
    return JSON.stringify(wave);
  }

  /**
   * Deserialize wave from network
   */
  deserialize(data: string): WavePattern {
    return JSON.parse(data);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private normalize(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export const waveEncoder = new WaveEncoder();
