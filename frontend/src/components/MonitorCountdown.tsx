import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'

interface MonitorCountdownProps {
  /** Seconds until the next monitor check, from the polled status. */
  nextCheckInSeconds: number | null | undefined
  /** Full interval length, used to fill the ring. */
  intervalSeconds: number
  miniMode: boolean
}

/**
 * The ticking ring in the sidebar.
 *
 * This owns its own 1-second timer deliberately. It used to live in Layout,
 * where setCountdown re-rendered the whole shell -- including <Outlet/> and
 * therefore the entire current page -- once per second on every route.
 */
export default function MonitorCountdown({
  nextCheckInSeconds,
  intervalSeconds,
  miniMode,
}: MonitorCountdownProps) {
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (nextCheckInSeconds === undefined || nextCheckInSeconds === null) return
    setCountdown(nextCheckInSeconds)
  }, [nextCheckInSeconds])

  useEffect(() => {
    if (countdown === null || countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((c) => (c !== null ? Math.max(0, c - 1) : null))
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const isReady = countdown === null || countdown <= 0
  const value = isReady ? intervalSeconds : Math.max(0, intervalSeconds - countdown)

  const radius = 20
  const size = 48
  const strokeWidth = 4
  const circumference = 2 * Math.PI * radius
  const pct = intervalSeconds > 0 ? Math.min(1, Math.max(0, value / intervalSeconds)) : 0
  const dashOffset = circumference * (1 - pct)

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg className="transform -rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none"
          className="text-muted/30"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={isReady ? 'text-success' : 'text-warning'}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {miniMode ? (
          <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <span className="text-[11px] font-semibold text-foreground">
            {isReady ? 'Ready' : `${countdown}s`}
          </span>
        )}
      </div>
    </div>
  )
}
