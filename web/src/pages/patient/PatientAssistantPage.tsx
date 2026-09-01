import { useState } from 'react'
import { uz } from '../../lib/uz'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Button, Card, Loading, Notice, Textarea } from '../../components/ui'
import type { AssistantReply, PatientQuestion } from '../../lib/types'
import { formatDateTime } from '../../lib/format'

/**
 * Hamshira AI, patient side.
 *
 * A refusal is not an error state: the reply is shown, followed by the
 * confirmation that the question reached a human and is waiting for an answer.
 * The queue below is the patient's own record of those questions.
 */
export function PatientAssistantPage() {
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<AssistantReply | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, loading, reload } = useApi<{ questions: PatientQuestion[] }>('/assistant/me/questions')

  async function send(text: string) {
    const trimmed = text.trim()
    if (trimmed.length < 3 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<AssistantReply>('/assistant/ask', { question: trimmed })
      setReply(result)
      setQuestion('')
      if (!result.answered) await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content stack">
      <div>
        <h1>{uz.assistant.title}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>{uz.assistant.subtitle}</p>
      </div>

      <Notice tone="info">{uz.assistant.intro}</Notice>

      <Card>
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={uz.assistant.placeholder}
          rows={3}
        />
        <div className="chip-group" style={{ marginTop: 12 }}>
          {uz.assistant.examples.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => { setQuestion(example); void send(example) }}
            >
              {example}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={busy || question.trim().length < 3}
          onClick={() => void send(question)}
          style={{ marginTop: 14 }}
        >
          {busy ? uz.assistant.sending : uz.assistant.send}
        </Button>
        {error ? <div className="field__error" style={{ marginTop: 10 }}>{error}</div> : null}
      </Card>

      {reply ? (
        <Card>
          {reply.emergency ? (
            <Notice tone="danger">
              <strong>{uz.assistant.emergencyTitle}:</strong> {reply.message}
            </Notice>
          ) : (
            <p style={{ whiteSpace: 'pre-line' }}>{reply.message}</p>
          )}

          {!reply.answered && !reply.emergency ? (
            <div className="stack--sm" style={{ marginTop: 14 }}>
              <Notice tone="warning">{reply.queued_message ?? uz.assistant.queued}</Notice>
              <span className="small muted">{reply.status_label ?? uz.assistant.waitingStatus}</span>
            </div>
          ) : null}

          {reply.answered && reply.sources && reply.sources.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div className="small strong">{uz.assistant.sources}</div>
              <ul className="stack--sm" style={{ marginTop: 6 }}>
                {reply.sources.map((source, index) => (
                  <li key={index} className="small muted">
                    {source.kind === 'hospital_staff_answer'
                      ? `${uz.assistant.answeredBy}: ${source.answered_at ?? ''}`
                      : source.kind === 'care_plan'
                        ? source.label
                        : `${source.source_org}: ${source.citation}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reply.disclaimer ? (
            <p className="small muted" style={{ marginTop: 12 }}>{reply.disclaimer}</p>
          ) : null}
        </Card>
      ) : null}

      <Card title={uz.assistant.myQuestions}>
        {loading ? (
          <Loading />
        ) : !data || data.questions.length === 0 ? (
          <p className="muted">{uz.assistant.noQuestions}</p>
        ) : (
          <div className="stack--sm">
            {data.questions.map((item) => (
              <div key={item.id} className="notice notice--info" style={{ display: 'block' }}>
                <div className="strong">{item.question}</div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {formatDateTime(item.created_at)} · {uz.questions.statuses[item.status]}
                </div>
                {item.answer ? (
                  <div style={{ marginTop: 10 }}>
                    <div className="small strong">
                      {uz.assistant.answeredBy}: {item.answered_by_name}
                    </div>
                    <p style={{ marginTop: 4 }}>{item.answer}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
