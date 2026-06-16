import { useEffect, useRef, useCallback, useState } from 'react'
import mpegts from 'mpegts.js'

interface FlvPlayerProps {
  src: string | null
  className?: string
  autoPlay?: boolean
  muted?: boolean
  controls?: boolean
  onError?: () => void
}

export default function FlvPlayer({
  src,
  className = '',
  autoPlay = false,
  muted = false,
  controls = true,
  onError,
}: FlvPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<mpegts.Player | null>(null)
  const [error, setError] = useState(false)

  const destroyPlayer = useCallback(() => {
    const player = playerRef.current
    if (player) {
      try {
        player.pause()
        player.unload()
        player.detachMediaElement()
        player.destroy()
      } catch {
        // Ignore cleanup errors
      }
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!src || !videoRef.current) return

    if (!mpegts.getFeatureList().mseLivePlayback) {
      setError(true)
      onError?.()
      return
    }

    setError(false)

    const player = mpegts.createPlayer({
      type: 'flv',
      url: src,
      isLive: true,
    })

    player.on(mpegts.Events.ERROR, (_errType: unknown, _errDetail: unknown, _errInfo: unknown) => {
      setError(true)
      onError?.()
    })

    player.attachMediaElement(videoRef.current)
    player.load()

    if (autoPlay) {
      player.play().catch(() => {
        // Autoplay might be blocked; user can click to play
      })
    }

    playerRef.current = player

    return () => {
      destroyPlayer()
    }
  }, [src, autoPlay, onError, destroyPlayer])

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-gray-900 ${className}`}>
        <p className="text-gray-400 text-sm">Stream playback error</p>
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className={`w-full h-full object-contain bg-black ${className}`}
      controls={controls}
      muted={muted}
      playsInline
    />
  )
}
