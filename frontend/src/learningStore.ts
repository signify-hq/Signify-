// localStorage-backed persistence for the Learning/Profile page

const KEYS = {
  user: 'signify_user',
  history: 'signify_history',
} as const

export interface SongEntry {
  song: string
  artist: string
  timestamp: number  // epoch ms
  duration: number   // seconds
}

export interface StreakInfo {
  current: number
  longest: number
}

// --- User ---

export function getUser(): string | null {
  return localStorage.getItem(KEYS.user) || null
}

export function setUser(name: string) {
  localStorage.setItem(KEYS.user, name)
}

export function clearUser() {
  localStorage.removeItem(KEYS.user)
}

// --- Song History ---

export function getHistory(): SongEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEYS.history) || '[]')
  } catch {
    return []
  }
}

export function logSong(song: string, artist: string, duration: number) {
  const history = getHistory()
  history.push({ song, artist, timestamp: Date.now(), duration })
  localStorage.setItem(KEYS.history, JSON.stringify(history))
}

// --- Stats ---

function uniqueDays(history: SongEntry[]): string[] {
  const days = new Set<string>()
  for (const entry of history) {
    days.add(new Date(entry.timestamp).toDateString())
  }
  return Array.from(days).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )
}

export function getStreak(): StreakInfo {
  const days = uniqueDays(getHistory())
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let current = 1

  // Check if today or yesterday is in the list (streak is still alive)
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const lastDay = days[days.length - 1]
  const streakAlive = lastDay === today || lastDay === yesterday

  // Walk through sorted days to find streaks
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime()
    const curr = new Date(days[i]).getTime()
    const diffDays = (curr - prev) / 86400000
    if (diffDays === 1) {
      current++
    } else {
      if (current > longest) longest = current
      current = 1
    }
  }
  if (current > longest) longest = current

  // If the streak isn't alive (last play was 2+ days ago), current = 0
  if (!streakAlive) current = 0

  return { current, longest }
}

export function getTotalListeningTime(): number {
  return getHistory().reduce((sum, e) => sum + e.duration, 0)
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
