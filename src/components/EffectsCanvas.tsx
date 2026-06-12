import { useEffect, useRef } from 'react'

type EffectTheme =
  | 'common'
  | 'excellent'
  | 'rare'
  | 'epic'
  | 'mythic'
  | 'limited'
  | 'eternal'
  | 'supreme'
  | 'mystery'
  | 'reroll'

export interface EffectBurst {
  id: string
  theme: EffectTheme
  mode?: 'center' | 'wheelRing'
  origin?: {
    x: number
    y: number
  }
  radius?: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  life: number
  kind: 'circle' | 'rect'
}

const THEME_COLORS: Record<EffectTheme, string[]> = {
  common: ['#ffffff', '#cbd5e1', '#8ec5ff'],
  excellent: ['#5ed5ff', '#7dc8ff', '#ffffff'],
  rare: ['#5df88c', '#b6ffcd', '#ffffff'],
  epic: ['#ff86fc', '#d88cff', '#ffffff'],
  mythic: ['#ff6d74', '#ffb26d', '#fff3e0'],
  limited: ['#ffb04e', '#ffd76b', '#fff1b1'],
  eternal: ['#ffd74d', '#fff4a1', '#ffffff'],
  supreme: ['#ffffff', '#ffe0ff', '#a4fbff'],
  mystery: ['#ffe567', '#ff8ef6', '#9efcff'],
  reroll: ['#8cf7ff', '#b0fff3', '#ffffff'],
}

const createParticles = (
  width: number,
  height: number,
  burst: EffectBurst,
  lowPerformanceMode: boolean,
) => {
  const theme = burst.theme
  const ringMode = burst.mode === 'wheelRing'
  const count = lowPerformanceMode ? 12 : theme === 'supreme' ? 28 : 20
  const colors = THEME_COLORS[theme]
  const centerX = burst.origin?.x ?? width / 2
  const centerY = burst.origin?.y ?? height * 0.42
  const radius = burst.radius ?? Math.min(width, height) * 0.22
  const particles: Particle[] = []

  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.35
    const startRadius = ringMode ? radius * (0.92 + Math.random() * 0.16) : 0
    const speed = (lowPerformanceMode ? 1.1 : 1.65) + Math.random() * (theme === 'supreme' ? 3.2 : 2.2)
    particles.push({
      x: centerX + Math.cos(angle) * startRadius,
      y: centerY + Math.sin(angle) * startRadius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (ringMode ? 0.18 : theme === 'supreme' ? 1.1 : 0.7),
      size: Math.random() * (theme === 'supreme' ? 8 : 5) + 2,
      color: colors[index % colors.length],
      life: 1,
      kind: index % 3 === 0 ? 'rect' : 'circle',
    })
  }

  return particles
}

export function EffectsCanvas({
  burst,
  lowPerformanceMode,
}: {
  burst: EffectBurst | null
  lowPerformanceMode: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !burst) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(width * window.devicePixelRatio))
      canvas.height = Math.max(1, Math.floor(height * window.devicePixelRatio))
      context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)
    }

    resize()
    window.addEventListener('resize', resize)

    const width = canvas.getBoundingClientRect().width
    const height = canvas.getBoundingClientRect().height
    const particles = createParticles(width, height, burst, lowPerformanceMode)
    let animationFrame = 0
    const startedAt = performance.now()

    const draw = (now: number) => {
      const elapsed = now - startedAt
      context.clearRect(0, 0, width, height)

      particles.forEach((particle) => {
        particle.x += particle.vx
        particle.y += particle.vy
        particle.vy += 0.03
        particle.life -= lowPerformanceMode ? 0.016 : 0.012

        if (particle.life <= 0) {
          return
        }

        context.save()
        context.globalAlpha = Math.max(0, particle.life)
        context.fillStyle = particle.color
        context.shadowColor = particle.color
        context.shadowBlur = lowPerformanceMode ? 0 : burst.theme === 'supreme' ? 18 : 10

        if (particle.kind === 'rect') {
          context.translate(particle.x, particle.y)
          context.rotate((elapsed / 240) * particle.vx)
          context.fillRect(
            -particle.size * 0.5,
            -particle.size * 0.5,
            particle.size,
            particle.size * 0.55,
          )
        } else {
          context.beginPath()
          context.arc(particle.x, particle.y, particle.size * 0.5, 0, Math.PI * 2)
          context.fill()
        }

        context.restore()
      })

      if (particles.some((particle) => particle.life > 0) && elapsed < 2600) {
        animationFrame = requestAnimationFrame(draw)
      } else {
        context.clearRect(0, 0, width, height)
      }
    }

    animationFrame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [burst, lowPerformanceMode])

  return <canvas className="effects-canvas" ref={canvasRef} aria-hidden="true" />
}
