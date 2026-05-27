type SoundKind =
  | 'click'
  | 'spinStart'
  | 'tick'
  | 'winCommon'
  | 'winHigh'
  | 'winSupreme'
  | 'mystery'
  | 'reroll'
  | 'error'

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const AudioContextConstructor =
  window.AudioContext ??
  (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

export class LuckySpinAudio {
  private context: AudioContext | null = null

  private ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      if (!AudioContextConstructor) {
        return null
      }

      this.context = new AudioContextConstructor()
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined)
    }

    return this.context
  }

  unlock() {
    const context = this.ensureContext()
    if (!context) {
      return
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }

    try {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = context.createBuffer(1, 1, context.sampleRate)
      gain.gain.value = 0.0001
      source.connect(gain)
      gain.connect(context.destination)
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
      }
      source.start(0)
    } catch {
      // Some browsers reject repeated silent unlocks; the next real sound can still play.
    }
  }

  private tone(
    frequency: number,
    duration: number,
    volume = 0.055,
    type: OscillatorType = 'sine',
    delay = 0,
    endFrequency?: number,
  ) {
    const context = this.ensureContext()
    if (!context) {
      return
    }

    if (context.state === 'closed') {
      return
    }

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startAt = context.currentTime + delay
    const endAt = startAt + duration

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startAt)
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, endAt)
    }
    gain.gain.setValueAtTime(0.0001, startAt)
    gain.gain.exponentialRampToValueAtTime(clamp(volume * 2.4, 0.001, 0.3), startAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(startAt)
    oscillator.stop(endAt)
  }

  play(kind: SoundKind) {
    switch (kind) {
      case 'click':
        this.tone(740, 0.075, 0.052)
        this.tone(990, 0.09, 0.04, 'triangle', 0.045)
        break
      case 'spinStart':
        this.tone(523, 0.11, 0.052, 'triangle')
        this.tone(659, 0.11, 0.05, 'triangle', 0.07)
        this.tone(784, 0.13, 0.048, 'sine', 0.14)
        this.tone(1046, 0.16, 0.042, 'sine', 0.23)
        break
      case 'tick':
        this.tone(1320, 0.045, 0.028, 'sine', 0, 1760)
        break
      case 'winCommon':
        this.tone(659, 0.12, 0.05, 'triangle')
        this.tone(880, 0.13, 0.048, 'sine', 0.08)
        this.tone(1175, 0.16, 0.042, 'sine', 0.16)
        break
      case 'winHigh':
        this.tone(784, 0.12, 0.058, 'triangle')
        this.tone(988, 0.13, 0.056, 'triangle', 0.08)
        this.tone(1318, 0.16, 0.052, 'sine', 0.16)
        this.tone(1760, 0.2, 0.048, 'sine', 0.26)
        break
      case 'winSupreme':
        this.tone(1046, 0.16, 0.064, 'triangle')
        this.tone(1318, 0.18, 0.06, 'sine', 0.08)
        this.tone(1568, 0.2, 0.058, 'sine', 0.17)
        this.tone(2093, 0.28, 0.052, 'sine', 0.27)
        this.tone(2637, 0.18, 0.036, 'sine', 0.43)
        break
      case 'mystery':
        this.tone(659, 0.1, 0.046, 'sine')
        this.tone(988, 0.11, 0.046, 'triangle', 0.07)
        this.tone(740, 0.1, 0.042, 'sine', 0.16)
        this.tone(1175, 0.18, 0.048, 'sine', 0.25)
        break
      case 'reroll':
        this.tone(880, 0.09, 0.046, 'triangle')
        this.tone(698, 0.08, 0.042, 'sine', 0.08)
        this.tone(1046, 0.14, 0.046, 'sine', 0.17)
        break
      case 'error':
        this.tone(392, 0.11, 0.05, 'triangle', 0, 330)
        this.tone(262, 0.12, 0.042, 'sine', 0.09, 220)
        break
      default:
        break
    }
  }
}
