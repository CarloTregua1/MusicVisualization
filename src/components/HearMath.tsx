export type ResynthState =
  | { status: 'idle' }
  | { status: 'building'; progress: number }
  | { status: 'ready'; key: string }

interface Props {
  state: ResynthState
  currentKey: string
  ab: 'original' | 'math'
  disabled: boolean
  onBuild: () => void
  onAB: (which: 'original' | 'math') => void
}

/** "Hear the math": render the N-term version of the track, then A/B it against the original. */
export function HearMath({ state, currentKey, ab, disabled, onBuild, onAB }: Props) {
  const stale = state.status === 'ready' && state.key !== currentKey
  return (
    <div className="hear">
      <span className="hear-label">Hear the math</span>
      {state.status === 'building' ? (
        <span className="progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)}>
          <span style={{ width: `${state.progress * 100}%` }} />
          <em>rendering {Math.round(state.progress * 100)}%</em>
        </span>
      ) : state.status === 'idle' || stale ? (
        <button className="btn" onClick={onBuild} disabled={disabled}>
          {stale ? 'Re-render with current N / window' : 'Render N-term audio'}
        </button>
      ) : null}
      {state.status === 'ready' && (
        <div className="seg" role="group" aria-label="A/B">
          <button aria-pressed={ab === 'original'} onClick={() => onAB('original')}>
            A · original
          </button>
          <button aria-pressed={ab === 'math'} onClick={() => onAB('math')}>
            B · math
          </button>
        </div>
      )}
    </div>
  )
}
