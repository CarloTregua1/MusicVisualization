interface Props {
  playing: boolean
  time: number
  duration: number
  disabled: boolean
  onToggle: () => void
  onSeek: (t: number) => void
}

function fmt(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export function Transport({ playing, time, duration, disabled, onToggle, onSeek }: Props) {
  return (
    <div className="transport">
      <button className="play" onClick={onToggle} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <span className="time">{fmt(time)}</span>
      <input
        className="scrubber"
        type="range"
        min={0}
        max={duration || 1}
        step={0.001}
        value={Math.min(time, duration || 1)}
        disabled={disabled}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Playback position"
      />
      <span className="time muted">{fmt(duration)}</span>
    </div>
  )
}
