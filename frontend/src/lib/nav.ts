import {
  LayoutDashboard,
  Users,
  Video,
  Tv,
  Radio,
  Scissors,
  BarChart3,
  Search,
  Database,
  Settings,
} from 'lucide-react'

/**
 * The app's navigation destinations, in sidebar order.
 *
 * Single source of truth: the sidebar and the command palette kept separate
 * copies, and the palette's had drifted to five entries -- Live, Clips, Stats,
 * Search and Storage were unreachable from it.
 */
export const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/watchlist', icon: Users, label: 'Watchlist' },
  { to: '/recordings', icon: Video, label: 'Recordings' },
  { to: '/watch', icon: Tv, label: 'Watch' },
  { to: '/live', icon: Radio, label: 'Live' },
  { to: '/clips', icon: Scissors, label: 'Clips' },
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/storage', icon: Database, label: 'Storage' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const
