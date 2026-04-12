import React, { useState, useEffect } from 'react'
import {
  getUser, setUser, clearUser,
  getHistory, getStreak, getTotalListeningTime, formatDuration,
  type SongEntry, type StreakInfo,
} from '../learningStore'

export function LearningPage({ onBack }: { onBack: () => void }) {
  const [username, setUsername] = useState(getUser())
  const [nameInput, setNameInput] = useState('')
  const [history, setHistory] = useState<SongEntry[]>([])
  const [streak, setStreak] = useState<StreakInfo>({ current: 0, longest: 0 })
  const [totalTime, setTotalTime] = useState(0)

  useEffect(() => {
    refreshData()
  }, [username])

  function refreshData() {
    setHistory(getHistory().reverse())
    setStreak(getStreak())
    setTotalTime(getTotalListeningTime())
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!nameInput.trim()) return
    setUser(nameInput.trim())
    setUsername(nameInput.trim())
  }

  function handleLogout() {
    clearUser()
    setUsername(null)
    setNameInput('')
  }

  const uniqueSigns = history.length * 12 // rough estimate: ~12 unique signs per song

  // ---------- Login screen ----------
  if (!username) {
    return (
      <div style={s.page}>
        <div style={s.loginWrap}>
          <img src="/logo.png" alt="Signify" style={{ width: 100, height: 100, objectFit: 'contain' as const, marginBottom: 12 }} />
          <h1 style={s.loginTitle}>SIGNIFY</h1>
          <p style={s.loginSub}>Track your ASL learning journey</p>
          <form onSubmit={handleLogin} style={s.loginForm}>
            <input
              style={s.loginInput}
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
            <button style={s.loginBtn} type="submit">Start Learning</button>
          </form>
          <button style={s.linkBtn} onClick={onBack}>Back to Player</button>
        </div>
      </div>
    )
  }

  // ---------- Dashboard ----------
  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backPill} onClick={onBack}>
          <span style={{ fontSize: 16 }}>&#8592;</span> Player
        </button>
        <div style={s.userChip}>
          <div style={s.avatar}>{username.charAt(0).toUpperCase()}</div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{username}</span>
          <button style={s.signOutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      </div>

      {/* Streak Hero */}
      <div style={s.streakCard}>
        <div style={s.streakRing}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            {/* Background ring */}
            <circle cx="60" cy="60" r="52" fill="none" stroke="#1e293b" strokeWidth="8" />
            {/* Progress ring — fills based on streak (7 day = full) */}
            <circle
              cx="60" cy="60" r="52"
              fill="none"
              stroke="url(#streakGrad)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${Math.min(streak.current / 7, 1) * 327} 327`}
              transform="rotate(-90 60 60)"
            />
            <defs>
              <linearGradient id="streakGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#ef4444" />
              </linearGradient>
            </defs>
          </svg>
          <div style={s.streakInner}>
            <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{streak.current}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>
              {streak.current === 1 ? 'DAY' : 'DAYS'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center' as const, marginTop: 16 }}>
          <div style={s.streakTitle}>
            {streak.current === 0 ? 'Start your streak!' : streak.current >= 7 ? 'On fire!' : 'Keep it going!'}
          </div>
          <div style={s.streakSub}>
            {streak.current === 0
              ? 'Play a song to begin learning ASL'
              : `Best streak: ${streak.longest} day${streak.longest !== 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statsRow}>
        <StatCard icon="&#9835;" value={String(history.length)} label="Songs" color="#8b5cf6" />
        <StatCard icon="&#9201;" value={formatDuration(totalTime)} label="Listened" color="#3b82f6" />
        <StatCard icon="&#9996;" value={String(uniqueSigns)} label="Signs Seen" color="#ec4899" />
      </div>

      {/* Quick Actions */}
      <div style={s.actionsRow}>
        <button style={s.actionBtn} onClick={onBack}>
          <span style={{ fontSize: 20 }}>&#9654;</span>
          <span>Play a Song</span>
        </button>
        <a href="?page=create" style={{ ...s.actionBtn, textDecoration: 'none' }}>
          <span style={{ fontSize: 20 }}>&#9998;</span>
          <span>Practice Signs</span>
        </a>
      </div>

      {/* Song History */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <h3 style={s.sectionTitle}>Recent Activity</h3>
          <span style={s.sectionBadge}>{history.length}</span>
        </div>
        {history.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9835;</div>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              No songs played yet
            </p>
            <p style={{ color: '#475569', fontSize: 13, margin: '4px 0 16px' }}>
              Play your first song to start tracking progress
            </p>
            <button style={s.emptyBtn} onClick={onBack}>Go to Player</button>
          </div>
        ) : (
          <div style={s.historyList}>
            {history.map((entry, i) => (
              <div key={i} style={s.historyItem}>
                <div style={s.historyAlbum}>
                  <span style={{ fontSize: 16, color: '#8b5cf6' }}>&#9835;</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.historySong}>{entry.song}</div>
                  <div style={s.historyMeta}>
                    {entry.artist && <span>{entry.artist}</span>}
                    <span style={s.dot} />
                    <span>{formatDuration(entry.duration)}</span>
                  </div>
                </div>
                <div style={s.historyTime}>{formatTimestamp(entry.timestamp)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Sub-components ----------

function StatCard({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  return (
    <div style={s.statCard}>
      <div style={{ fontSize: 18, marginBottom: 6 }} dangerouslySetInnerHTML={{ __html: icon }} />
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, marginTop: 4 }}>{label}</div>
    </div>
  )
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(Date.now() - 86400000)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today ${time}`
  if (isYesterday) return `Yesterday ${time}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// ---------- Styles ----------
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1117 100%)',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    position: 'sticky' as const,
    top: 0,
    background: 'rgba(10, 10, 10, 0.85)',
    backdropFilter: 'blur(12px)',
    zIndex: 10,
    borderBottom: '1px solid #ffffff08',
  },
  backPill: {
    background: 'rgba(255,255,255,0.06)',
    border: 'none',
    borderRadius: 999,
    padding: '8px 16px 8px 12px',
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  userChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    padding: '4px 14px 4px 4px',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 13,
    color: '#fff',
  },
  signOutBtn: {
    background: 'none',
    border: 'none',
    color: '#475569',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    marginLeft: 2,
  },
  // Streak
  streakCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '32px 20px 24px',
  },
  streakRing: {
    position: 'relative' as const,
    width: 120,
    height: 120,
  },
  streakInner: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakTitle: {
    fontSize: 18,
    fontWeight: 700,
    background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  streakSub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  // Stats
  statsRow: {
    display: 'flex',
    gap: 10,
    padding: '0 20px',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: '14px 12px',
    textAlign: 'center' as const,
  },
  // Actions
  actionsRow: {
    display: 'flex',
    gap: 10,
    padding: '0 20px',
    marginBottom: 28,
  },
  actionBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.15))',
    border: '1px solid rgba(139,92,246,0.2)',
    borderRadius: 12,
    padding: '14px 16px',
    color: '#c4b5fd',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Section
  section: {
    padding: '0 20px 40px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#94a3b8',
    margin: 0,
  },
  sectionBadge: {
    background: 'rgba(139,92,246,0.2)',
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 999,
  },
  // Empty state
  emptyState: {
    textAlign: 'center' as const,
    padding: '40px 20px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    border: '1px dashed #1e293b',
  },
  emptyBtn: {
    background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
    border: 'none',
    borderRadius: 8,
    padding: '10px 24px',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  // History
  historyList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: '10px 14px',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  historyAlbum: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: 'rgba(139,92,246,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  historySong: {
    fontWeight: 600,
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  historyMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#475569',
    display: 'inline-block',
  },
  historyTime: {
    fontSize: 11,
    color: '#475569',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  // Login
  loginWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: 24,
  },
  loginTitle: {
    fontSize: 42,
    fontWeight: 800,
    letterSpacing: 6,
    margin: 0,
    background: 'linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  loginSub: {
    color: '#64748b',
    fontSize: 15,
    marginTop: 8,
    marginBottom: 24,
  },
  loginForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    width: '100%',
    maxWidth: 300,
  },
  loginInput: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '14px 16px',
    color: '#e2e8f0',
    fontSize: 16,
    outline: 'none',
    textAlign: 'center' as const,
  },
  loginBtn: {
    background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
    border: 'none',
    borderRadius: 10,
    padding: '14px 24px',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    cursor: 'pointer',
    marginTop: 16,
    padding: 0,
  },
}
