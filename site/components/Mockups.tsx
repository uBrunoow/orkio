import type { Dictionary } from '@/i18n/pt-BR'
import styles from '@/app/home.module.css'

/** Quadro do projeto (decorativo; a descrição vai na legenda). */
export function BoardMockup({ t }: { t: Dictionary }) {
  const cards: Record<
    number,
    { id: string; title: string; chip?: { text: string; tone: string } }[]
  > = {
    0: [{ id: 'ORK-151', title: 'Exportar tarefas em CSV' }],
    1: [
      {
        id: 'ORK-142',
        title: 'Listar tarefas do Notion',
        chip: { text: t.board.agent, tone: styles.chipAgent ?? '' }
      }
    ],
    2: [
      {
        id: 'ORK-138',
        title: 'Filtro por prioridade',
        chip: { text: t.board.review, tone: styles.chipWarn ?? '' }
      }
    ],
    3: [
      {
        id: 'ORK-131',
        title: 'Login com GitHub',
        chip: { text: t.board.ci, tone: styles.chipOk ?? '' }
      }
    ]
  }
  return (
    <figure className={styles.board}>
      <div className={styles.boardCols} aria-hidden="true">
        {t.board.columns.map((col, i) => (
          <div key={col} className={styles.boardCol}>
            <p className={styles.boardColName}>{col}</p>
            {(cards[i] ?? []).map((c) => (
              <div key={c.id} className={styles.boardCard}>
                <code className={styles.taskId}>{c.id}</code>
                <p>{c.title}</p>
                {c.chip && (
                  <span className={`${styles.chip} ${c.chip.tone}`}>
                    <span className={styles.dot} />
                    {c.chip.text}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>{t.board.caption}</figcaption>
    </figure>
  )
}

/** Gate antes do push (decorativo). */
export function GateMockup({ t }: { t: Dictionary }) {
  return (
    <div className={styles.gate} aria-hidden="true">
      <p className={styles.gateTitle}>{t.safety.gate.title}</p>
      <dl className={styles.gateRows}>
        <div>
          <dt>{t.safety.gate.destination}</dt>
          <dd>
            <code>origin → ORK-142/listar-tarefas</code>
          </dd>
        </div>
        <div>
          <dt>{t.safety.gate.commits}</dt>
          <dd>
            <code>a1c9e2f</code> feat: listar tarefas do Notion
            <br />
            <code>7be0d41</code> test: cobre o filtro por projeto
          </dd>
        </div>
      </dl>
      <pre className={styles.diff}>
        <code>
          {' src/notion/tasks.ts      | 48 '}
          <span className={styles.add}>{'++++++++'}</span>
          {'\n src/notion/tasks.test.ts | 31 '}
          <span className={styles.add}>{'+++++'}</span>
          {'\n 2 files changed, 79 insertions(+)'}
        </code>
      </pre>
      <div className={styles.gateActions}>
        <span className={styles.gateApprove}>{t.safety.gate.approve}</span>
        <span className={styles.gateReject}>{t.safety.gate.reject}</span>
      </div>
    </div>
  )
}
