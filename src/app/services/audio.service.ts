import { Injectable } from '@angular/core';
import { midiToFrequency } from '../../core/kalimba';

interface ActiveVoice {
  stop(): void;
}

@Injectable({ providedIn: 'root' })
export class AudioService {
  private context: AudioContext | null = null;
  private readonly activeNotes = new Set<ActiveVoice>();

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        // El navegador puede bloquear el audio hasta el siguiente gesto.
      }
    }
  }

  click(accent = false): void {
    const context = this.ensureContext();
    if (!context || context.state === 'suspended') {
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(accent ? 1320 : 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.07);
  }

  playNotes(midis: readonly number[], durationMs: number): void {
    const context = this.ensureContext();
    if (!context || context.state === 'suspended' || midis.length === 0) {
      return;
    }

    const notes = [...new Set(midis)];
    const now = context.currentTime + 0.004;
    const seconds = Math.min(2.2, Math.max(0.3, durationMs / 1000));
    const level = Math.min(0.2, 0.26 / Math.sqrt(notes.length));

    for (const midi of notes) {
      const frequency = midiToFrequency(midi);
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);

      const harmonic = context.createOscillator();
      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(frequency * 2.005, now);

      const harmonicGain = context.createGain();
      harmonicGain.gain.setValueAtTime(0.18, now);

      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(level, now + 0.006);
      envelope.gain.exponentialRampToValueAtTime(level * 0.32, now + 0.14);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

      oscillator.connect(envelope);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(envelope);
      envelope.connect(context.destination);

      const voice: ActiveVoice = {
        stop: () => {
          const at = context.currentTime;
          try {
            envelope.gain.cancelScheduledValues(at);
            envelope.gain.setTargetAtTime(0.0001, at, 0.012);
            oscillator.stop(at + 0.04);
            harmonic.stop(at + 0.04);
          } catch {
            // La voz ya había terminado.
          }
        },
      };

      this.activeNotes.add(voice);
      oscillator.onended = () => this.activeNotes.delete(voice);
      harmonic.onended = () => this.activeNotes.delete(voice);

      oscillator.start(now);
      harmonic.start(now);
      oscillator.stop(now + seconds + 0.05);
      harmonic.stop(now + seconds + 0.05);
    }
  }

  stopAllNotes(): void {
    for (const voice of [...this.activeNotes]) {
      voice.stop();
    }
    this.activeNotes.clear();
  }

  close(): void {
    this.stopAllNotes();
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    if (typeof window === 'undefined') {
      return null;
    }
    const ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctor) {
      return null;
    }
    try {
      this.context = new ctor();
    } catch {
      this.context = null;
    }
    return this.context;
  }
}
