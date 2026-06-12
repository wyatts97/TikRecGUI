import { useState } from 'react'
import { Scissors } from 'lucide-react'
import { Button } from '@/components/selia/button'
import { Input } from '@/components/selia/input'
import { Label } from '@/components/selia/label'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/selia/dialog'
import { api, type Recording } from '@/lib/api'
import toast from 'react-hot-toast'

interface ClipDialogProps {
  recording: Recording
  open: boolean
  onOpenChange: (open: boolean) => void
  onClipCreated?: () => void
}

function formatTimeInput(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

function parseTimeInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Plain seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }

  // MM:SS or HH:MM:SS
  const parts = trimmed.split(':').map((p) => parseInt(p, 10))
  if (parts.some(isNaN)) return null

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }

  return null
}

export default function ClipDialog({
  recording,
  open,
  onOpenChange,
  onClipCreated,
}: ClipDialogProps) {
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [title, setTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const maxDuration = recording.duration_seconds || 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const start = parseTimeInput(startTime)
    const end = parseTimeInput(endTime)

    if (start === null || end === null) {
      toast.error('Invalid time format. Use seconds, MM:SS, or HH:MM:SS.')
      return
    }

    if (start >= end) {
      toast.error('Start time must be less than end time.')
      return
    }

    if (maxDuration > 0 && end > maxDuration) {
      toast.error(`End time exceeds recording duration (${maxDuration}s).`)
      return
    }

    if (start < 0) {
      toast.error('Start time must be 0 or greater.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.clips.create({
        recording_id: recording.id,
        start_time: start,
        end_time: end,
        title: title.trim() || null,
      })
      toast.success('Clip created successfully')
      setStartTime('')
      setEndTime('')
      setTitle('')
      onOpenChange(false)
      onClipCreated?.()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create clip')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogPopup>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Clip</DialogTitle>
            <DialogDescription>
              Extract a segment from @{recording.username}.
              {maxDuration > 0 && (
                <span className="block mt-1">
                  Recording duration: {formatTimeInput(maxDuration)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="clip-start">Start Time</Label>
                <Input
                  id="clip-start"
                  placeholder="0:00"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clip-end">End Time</Label>
                <Input
                  id="clip-end"
                  placeholder="0:30"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Accepts seconds (e.g. 30), MM:SS (e.g. 1:30), or HH:MM:SS.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="clip-title">Title (optional)</Label>
              <Input
                id="clip-title"
                placeholder="e.g. Funny moment"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>Creating…</>
              ) : (
                <>
                  <Scissors className="h-4 w-4 mr-1.5" />
                  Create Clip
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
