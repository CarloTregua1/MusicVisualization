import { useEffect, useRef, useState } from 'react'

interface Props {
  onFile: (file: File) => void
  /** Once a file is loaded the zone shrinks to a button, but the whole window still accepts drops. */
  compact: boolean
  busy?: boolean
}

export function DropZone({ onFile, compact, busy }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      depth++
      setOver(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overFn = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setOver(false)
      const file = e.dataTransfer?.files[0]
      if (file) onFile(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [onFile])

  const picker = (
    <input
      ref={input}
      type="file"
      accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) onFile(file)
        e.target.value = ''
      }}
    />
  )

  return (
    <>
      {compact ? (
        <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
          Open audio…
        </button>
      ) : (
        <button className="dropzone" onClick={() => input.current?.click()} disabled={busy}>
          <span className="dropzone-title">{busy ? 'Decoding…' : 'Drop an audio file'}</span>
          <span className="dropzone-sub">or click to choose · mp3, wav, ogg, flac, anything your browser can decode</span>
        </button>
      )}
      {picker}
      {over && <div className="drop-overlay">Drop to load</div>}
    </>
  )
}
