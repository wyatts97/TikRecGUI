import { Check } from 'lucide-react'
import { ACCENT_PRESETS, useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

/**
 * Accent color picker. Lets the user override the app's `--primary` token with a
 * built-in preset or a fully custom color. Persists via the theme provider.
 */
export default function AccentPicker() {
  const { accent, setAccent } = useTheme()

  const isCustom = !ACCENT_PRESETS.some((p) => p.key === accent)
  // The custom color input only accepts hex; fall back to a neutral when the
  // active accent is a non-hex preset value.
  const customValue = isCustom && accent.startsWith('#') ? accent : '#7c3aed'

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Accent color</p>
      <div className="flex flex-wrap items-center gap-2.5">
        {ACCENT_PRESETS.map((preset) => {
          const active = accent === preset.key
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => setAccent(preset.key)}
              aria-label={`${preset.label} accent`}
              aria-pressed={active}
              title={preset.label}
              className={cn(
                'relative h-8 w-8 rounded-full transition-transform hover:scale-110',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-foreground/40',
                active && 'ring-2 ring-offset-2 ring-offset-background ring-foreground/60',
              )}
              style={{ backgroundColor: preset.swatch }}
            >
              {active && (
                <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
              )}
            </button>
          )
        })}

        {/* Custom color */}
        <label
          className={cn(
            'relative h-8 w-8 rounded-full cursor-pointer transition-transform hover:scale-110 overflow-hidden',
            'ring-1 ring-border',
            isCustom && 'ring-2 ring-offset-2 ring-offset-background ring-foreground/60',
          )}
          title="Custom color"
          style={{
            background: isCustom
              ? customValue
              : 'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)',
          }}
        >
          <input
            type="color"
            value={customValue}
            onChange={(e) => setAccent(e.target.value)}
            aria-label="Custom accent color"
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Personalize the highlight color used across buttons, links, and active states.
      </p>
    </div>
  )
}
