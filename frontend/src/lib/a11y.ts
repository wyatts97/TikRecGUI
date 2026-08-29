import type { KeyboardEvent } from 'react'

/**
 * Props that make a non-interactive container behave like a button.
 *
 * Several containers (dashboard stat cards, activity rows, live stream cards,
 * watchlist table rows) are navigable but were plain divs with only an
 * onClick: unreachable by keyboard and announced as nothing by screen readers.
 * Spread this onto them rather than re-deriving the handler each time.
 *
 * Prefer a real <button> or <a> when the element is not already a card/row --
 * this is for the cases where the semantics have to be layered on.
 */
export function clickable(onActivate: () => void, label?: string) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      // Enter and Space are what a real button responds to.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    },
  } as const
}
