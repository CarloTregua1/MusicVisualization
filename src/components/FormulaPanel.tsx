import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

const GENERIC = String.raw`x(t) \approx \sum_{k=1}^{N} A_k \sin\!\left(2\pi f_k\,(t-t_0) + \varphi_k\right)`

function render(tex: string): string {
  return katex.renderToString(tex, { displayMode: true, throwOnError: false })
}

export function FormulaPanel({ latex, frameLabel }: { latex: string | null; frameLabel: string }) {
  const generic = useMemo(() => render(GENERIC), [])
  const live = useMemo(() => (latex ? render(latex) : null), [latex])
  return (
    <section className="panel formula-panel" aria-label="Formula">
      <div className="formula-generic" dangerouslySetInnerHTML={{ __html: generic }} />
      {live ? (
        <div className="formula-live" dangerouslySetInnerHTML={{ __html: live }} />
      ) : (
        <div className="formula-empty">Load a file and press play to see its math.</div>
      )}
      <div className="formula-meta">{frameLabel}</div>
    </section>
  )
}
