import { useCallback, useState, type CSSProperties, type PointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'

interface SpriteCue {
  start: number
  end: number
  url: string
  x: number
  y: number
  w: number
  h: number
}

function parseTime(value: string): number {
  const parts = value.trim().split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** Parse a WEBVTT sprite map (`sprite#xywh=x,y,w,h` cues) into absolute cues. */
export function parseSpriteVtt(text: string, vttUrl: string): SpriteCue[] {
  const base = new URL(vttUrl, window.location.href)
  const cues: SpriteCue[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const timing = lines[i].match(/^(\S+)\s+-->\s+(\S+)/)
    const ref = lines[i + 1]?.trim()
    if (!timing || !ref) continue
    const [file, hash] = ref.split('#xywh=')
    if (!hash) continue
    const [x, y, w, h] = hash.split(',').map(Number)
    cues.push({
      start: parseTime(timing[1]),
      end: parseTime(timing[2]),
      url: new URL(file, base).toString(),
      x, y, w, h,
    })
  }
  return cues
}

/**
 * Hover-scrub preview from a recording's or clip's thumbnail sprite.
 *
 * The VTT is fetched on first hover (not on mount), so a grid of cards costs
 * nothing until the pointer actually moves over one. Returns handlers for the
 * card's media area and a style for an absolutely positioned overlay div,
 * which is null while not scrubbing so the static thumbnail shows through.
 */
export function useSpriteScrub(vttUrl: string | null) {
  const [hovering, setHovering] = useState(false)
  const [fraction, setFraction] = useState<number | null>(null)

  const { data: cues } = useQuery({
    queryKey: ['sprite-vtt', vttUrl],
    queryFn: async () => {
      const res = await fetch(vttUrl!, { credentials: 'include' })
      if (!res.ok) throw new Error(`sprite map ${res.status}`)
      return parseSpriteVtt(await res.text(), vttUrl!)
    },
    enabled: hovering && !!vttUrl,
    staleTime: Infinity,
    retry: false,
  })

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setFraction(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)))
  }, [])

  const onPointerEnter = useCallback(() => setHovering(true), [])
  const onPointerLeave = useCallback(() => setFraction(null), [])

  let style: CSSProperties | null = null
  if (fraction !== null && cues && cues.length > 0) {
    const cue = cues[Math.min(cues.length - 1, Math.floor(fraction * cues.length))]
    // Scale the tile to fill the card: background-size is the whole sheet
    // expressed in tile widths, position is the tile's offset in tile units.
    const cols = Math.max(...cues.map((c) => c.x)) / cue.w + 1
    const rows = Math.max(...cues.map((c) => c.y)) / cue.h + 1
    style = {
      backgroundImage: `url("${cue.url}")`,
      backgroundSize: `${cols * 100}% ${rows * 100}%`,
      backgroundPosition: `${cols > 1 ? (cue.x / cue.w / (cols - 1)) * 100 : 0}% ${
        rows > 1 ? (cue.y / cue.h / (rows - 1)) * 100 : 0
      }%`,
    }
  }

  return {
    handlers: vttUrl ? { onPointerEnter, onPointerMove, onPointerLeave } : {},
    style,
    /** 0..1 position of the pointer, for a progress hairline. */
    fraction: style ? fraction : null,
  }
}
