import { useState } from 'react'
import { uz } from '../../lib/uz'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Loading, Notice, Textarea } from '../../components/ui'
import type { QueueQuestion, QuestionDetail } from '../../lib/types'
import { formatDateTime } from '../../lib/format'

const PRIORITY_TONE = { urgent: 'urgent', high: 'attention', normal: 'neutral' } as const

/** The detail view: the question beside the record needed to answer it. */
function QuestionDetailCard({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { data, loading, reload } = useApi<QuestionDetail>(`/assistant/questions/${id}`, [id])
  const [answer, setAnswer] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <Card><Loading /></Card>
  if (!data) return null

  const { question, trend, medications, notes } = data
  const week = trend.last_7_days

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await reload()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <Card title={`${question.last_name} ${question.first_name}`} subtitle={formatDateTime(question.created_at)}>
        <p className="strong" style={{ fontSize: '1.05rem' }}>{question.question}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <Badge tone={PRIORITY_TONE[question.priority]}>{uz.questions.priorities[question.priority]}</Badge>
          <Badge tone="neutral">{uz.questions.statuses[question.status]}</Badge>
          {question.assigned_to_name
            ? <Badge tone="info">{question.assigned_to_name}</Badge>
            : <Badge tone="neutral">{uz.questions.unassigned}</Badge>}
        </div>
        {question.refusal_reason ? (
          <p className="small muted" style={{ marginTop: 12 }}>
            {uz.questions.refusalReason}:{' '}
            {uz.questions.refusalReasons[question.refusal_reason as keyof typeof uz.questions.refusalReasons]
              ?? question.refusal_reason}
          </p>
        ) : null}
      </Card>

      <Card title={uz.questions.retrievedSources}>
        {question.retrieved_sources.length === 0 ? (
          <p className="muted">{uz.questions.noSources}</p>
        ) : (
          <div className="stack--sm">
            {question.retrieved_sources.map((source, index) => (
              <div key={index} className="small">
                <span className="strong">
                  {source.kind === 'hospital_staff_answer'
                    ? 'hospital_staff_answer'
                    : source.kind === 'care_plan' ? source.label : source.source_org}
                </span>
                {source.citation ? <span className="muted"> · {source.citation}</span> : null}
                {typeof source.score === 'number' ? <span className="muted"> · {source.score}</span> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={uz.trend.title} subtitle={`${uz.trend.last7} · ${week.all.count} ${uz.trend.readings}`}>
        {week.all.count === 0 ? (
          <p className="muted">{uz.trend.noData}</p>
        ) : (
          <dl className="kv">
            <dt>{uz.trend.average}</dt><dd>{week.all.average} {week.all.unit}</dd>
            <dt>{uz.trend.min} / {uz.trend.max}</dt><dd>{week.all.min} – {week.all.max}</dd>
            {week.fasting.count > 0 ? (<><dt>{uz.trend.fasting}</dt><dd>{week.fasting.average} {week.fasting.unit} ({week.fasting.count})</dd></>) : null}
            {week.post_meal.count > 0 ? (<><dt>{uz.trend.postMeal}</dt><dd>{week.post_meal.average} {week.post_meal.unit} ({week.post_meal.count})</dd></>) : null}
            {week.in_range ? (<><dt>{uz.trend.inRange}</dt><dd>{week.in_range.percent}% ({week.in_range.low}–{week.in_range.high})</dd></>) : null}
            {week.change ? (<><dt>{uz.trend.change}</dt><dd>{week.change.delta > 0 ? '+' : ''}{week.change.delta} {week.change.unit}</dd></>) : null}
          </dl>
        )}
        {!week.in_range ? <p className="small muted" style={{ marginTop: 10 }}>{uz.trend.noRange}</p> : null}
      </Card>

      <Card title={uz.questions.medications}>
        {medications.length === 0 ? (
          <p className="muted">{uz.register.noMedications}</p>
        ) : (
          <dl className="kv">
            {medications.map((med, index) => (
              <div key={index} style={{ display: 'contents' }}>
                <dt>{med.name}</dt>
                <dd>{med.dose} {med.unit} · {med.times ?? '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {question.answer ? (
        <Notice tone="success">
          <div>
            <div className="strong">{question.answered_by_name}</div>
            <p style={{ marginTop: 4 }}>{question.answer}</p>
          </div>
        </Notice>
      ) : (
        <Card title={uz.questions.answerLabel}>
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={uz.questions.answerPlaceholder}
            rows={4}
          />
          <p className="small muted" style={{ marginTop: 8 }}>{uz.questions.answeredNote}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              disabled={busy || answer.trim().length < 2}
              onClick={() => void act(() => api.post(`/assistant/questions/${id}/answer`, { answer: answer.trim() }))}
            >
              {uz.questions.submitAnswer}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void act(() => api.post(`/assistant/questions/${id}/assign`, {}))}
            >
              {uz.questions.assignToMe}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void act(() => api.post(`/assistant/questions/${id}/close`, {}))}
            >
              {uz.questions.close}
            </Button>
          </div>
          {error ? <div className="field__error" style={{ marginTop: 10 }}>{error}</div> : null}
        </Card>
      )}

      <Card title={uz.questions.internalNotes}>
        {notes.length > 0 ? (
          <div className="stack--sm" style={{ marginBottom: 12 }}>
            {notes.map((entry) => (
              <div key={entry.id} className="small">
                <span className="strong">{entry.full_name}</span>
                <span className="muted"> · {formatDateTime(entry.created_at)}</span>
                <div>{entry.note}</div>
              </div>
            ))}
          </div>
        ) : null}
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={uz.questions.notePlaceholder}
          rows={2}
        />
        <Button
          size="sm"
          disabled={busy || note.trim().length < 2}
          style={{ marginTop: 10 }}
          onClick={() => void act(async () => {
            await api.post(`/assistant/questions/${id}/notes`, { note: note.trim() })
            setNote('')
          })}
        >
          {uz.questions.addNote}
        </Button>
      </Card>
    </div>
  )
}

export function QuestionsPage() {
  const { data, loading, reload } = useApi<{ questions: QueueQuestion[] }>('/assistant/questions')
  const [selected, setSelected] = useState<number | null>(null)

  if (loading) return <div className="content"><Loading /></div>

  if (selected !== null) {
    return (
      <div className="content stack">
        <Button size="sm" onClick={() => setSelected(null)}>← {uz.app.back}</Button>
        <QuestionDetailCard id={selected} onChanged={reload} />
      </div>
    )
  }

  const questions = data?.questions ?? []

  return (
    <div className="content stack">
      <div>
        <h1>{uz.questions.title}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>{uz.questions.subtitle}</p>
      </div>

      <Card flush>
        {questions.length === 0 ? (
          <Empty icon="✅" title={uz.questions.empty} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{uz.questions.patient}</th>
                  <th>{uz.questions.question}</th>
                  <th>{uz.questions.priority}</th>
                  <th>{uz.questions.status}</th>
                  <th>{uz.questions.assignedTo}</th>
                  <th>{uz.questions.askedAt}</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((item) => (
                  <tr key={item.id} onClick={() => setSelected(item.id)}>
                    <td>{item.last_name} {item.first_name}</td>
                    <td>{item.question.length > 70 ? `${item.question.slice(0, 70)}…` : item.question}</td>
                    <td><Badge tone={PRIORITY_TONE[item.priority]}>{uz.questions.priorities[item.priority]}</Badge></td>
                    <td>{uz.questions.statuses[item.status]}</td>
                    <td>{item.assigned_to_name ?? uz.questions.unassigned}</td>
                    <td>{formatDateTime(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
