import { useCallback, useEffect, useRef, useState } from 'react'
import { uz } from '../lib/uz'
import { api, ApiError, tokenStore } from '../lib/api'
import type { AssistantSource } from '../lib/types'

/**
 * Hamshira AI, as a floating panel over whichever screen the patient is on.
 *
 * Everything the panel reports about limits comes from the server on every
 * turn — the counters here are a display of `usage`, never a local tally, so
 * the interface cannot drift from what the backend will actually allow.
 */

interface ChatMessage {
  id: number
  role: 'patient' | 'assistant'
  kind: 'text' | 'voice' | 'image'
  content: string
  answered: number | null
  refusal_reason: string | null
  question_id: number | null
  sources: AssistantSource[]
  created_at: string
}

interface Usage {
  date: string
  voice: { used: number; limit: number }
  image: { used: number; limit: number }
}

interface ConversationResponse {
  conversation: { id: number; summary: string | null }
  messages: ChatMessage[]
  usage: Usage
  voice_enabled: boolean
  image_enabled: boolean
}

function clockOf(value: string) {
  const match = /\d{2}:\d{2}/.exec(value)
  return match ? match[0] : ''
}

/** Citations sit behind a summary so they never break the flow of reading. */
function Citations({ sources }: { sources: AssistantSource[] }) {
  if (!sources || sources.length === 0) return null
  const shown = sources.filter((s) => s.kind !== 'care_plan' || s.label)
  if (shown.length === 0) return null

  return (
    <details className="cites">
      <summary>
        <span aria-hidden>🛡</span>
        {uz.assistant.sources}
        <span className="muted"> ({shown.length})</span>
      </summary>
      <div className="cites__list">
        {shown.map((source, index) => (
          <div className="cites__item" key={index}>
            <span className="cites__org">
              {source.kind === 'hospital_staff_answer'
                ? uz.assistant.staffSource
                : source.kind === 'care_plan'
                  ? uz.assistant.planSource
                  : source.source_org}
            </span>
            {source.kind === 'hospital_staff_answer'
              ? source.answer
              : source.kind === 'care_plan'
                ? `${source.low}–${source.high}`
                : source.citation}
          </div>
        ))}
      </div>
    </details>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const refused = message.role === 'assistant' && message.answered === 0
  const tone = refused
    ? (message.refusal_reason === 'emergency_protocol' ? 'bubble--emergency' : 'bubble--refusal')
    : ''

  return (
    <div className={`bubble bubble--${message.role} ${tone}`}>
      {message.kind !== 'text' ? (
        <span className="bubble__kind">
          {message.kind === 'voice' ? uz.assistant.voiceNote : uz.assistant.photo}
        </span>
      ) : null}
      <div className="bubble__body">
        {message.content}
        {refused && message.question_id ? (
          <div className="bubble__queued">
            {uz.assistant.queued}
            <br />
            {uz.assistant.waitingStatus}
          </div>
        ) : null}
        {message.role === 'assistant' && message.answered === 1 ? (
          <Citations sources={message.sources} />
        ) : null}
      </div>
      <span className="bubble__time">{clockOf(message.created_at)}</span>
    </div>
  )
}

export function HamshiraChat() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState<ConversationResponse | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const logRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.get<ConversationResponse>('/chat/conversation'))
      setLoaded(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
      setLoaded(true)
    }
  }, [])

  useEffect(() => { if (open && !loaded) void load() }, [open, loaded, load])

  // New turns should be visible without the patient scrolling for them.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [data?.messages.length, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); fabRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function absorb(result: { usage?: Usage }) {
    void load()
    if (result.usage && data) setData({ ...data, usage: result.usage })
  }

  async function send() {
    const text = draft.trim()
    if (text.length < 2 || busy) return
    setBusy(true)
    setError(null)
    setDraft('')
    try {
      absorb(await api.post<{ usage?: Usage }>('/chat/message', { text }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
    }
  }

  /** Raw bytes go straight to the endpoint; the server owns the allowance. */
  async function upload(path: string, blob: Blob, mime: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': mime, Authorization: `Bearer ${tokenStore.get()}` },
        body: blob,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new ApiError(response.status, payload.error ?? uz.app.errorGeneric)
      absorb(payload)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : uz.app.errorGeneric)
    } finally {
      setBusy(false)
      void load()
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => chunks.push(event.data)
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunks, { type: recorder.mimeType })
        void upload('/chat/voice', blob, recorder.mimeType || 'audio/webm')
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setError(uz.assistant.micDenied)
    }
  }

  const usage = data?.usage
  const voiceLeft = usage ? usage.voice.limit - usage.voice.used : 0
  const imageLeft = usage ? usage.image.limit - usage.image.used : 0

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="hamshira-fab"
        onClick={() => setOpen(true)}
        aria-label={uz.assistant.open}
        aria-expanded={open}
      >
        <span aria-hidden>💬</span>
        <span className="hamshira-fab__dot" aria-hidden />
      </button>

      <div
        className={`hamshira-scrim ${open ? 'hamshira-scrim--on' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside
        ref={panelRef}
        className={`hamshira ${open ? 'hamshira--open' : ''}`}
        aria-label={uz.assistant.title}
        inert={!open}
      >
        <header className="hamshira__head">
          <div className="hamshira__avatar" aria-hidden>🩺</div>
          <div>
            <div className="hamshira__name">{uz.assistant.title}</div>
            <div className="hamshira__status">{uz.assistant.online}</div>
          </div>
          <button
            type="button"
            className="hamshira__close"
            onClick={() => { setOpen(false); fabRef.current?.focus() }}
            aria-label={uz.app.close}
          >
            ✕
          </button>
        </header>

        {usage ? (
          <div className="hamshira__usage">
            <span>{uz.assistant.usageTitle}</span>
            <span>{uz.assistant.voiceLabel}: <strong>{usage.voice.used} / {usage.voice.limit}</strong></span>
            <span>{uz.assistant.imageLabel}: <strong>{usage.image.used} / {usage.image.limit}</strong></span>
          </div>
        ) : null}

        <div className="hamshira__log" ref={logRef}>
          <div className="hamshira__intro">{uz.assistant.intro}</div>
          {data?.messages.map((message) => <Bubble key={message.id} message={message} />)}
          {busy ? (
            <div className="bubble bubble--assistant">
              <div className="bubble__body typing" aria-label={uz.assistant.typing}>
                <span /><span /><span />
              </div>
            </div>
          ) : null}
        </div>

        {error ? <div className="hamshira__error">{error}</div> : null}

        <div className="hamshira__compose">
          <textarea
            className="hamshira__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
            }}
            placeholder={uz.assistant.placeholder}
            rows={1}
            disabled={busy}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload('/chat/image', file, file.type)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            className="hamshira__act"
            disabled={busy || !data?.image_enabled || imageLeft <= 0}
            onClick={() => fileRef.current?.click()}
            aria-label={uz.assistant.sendPhoto}
            title={imageLeft <= 0 ? uz.assistant.imageLimit : uz.assistant.sendPhoto}
          >
            📷
          </button>
          <button
            type="button"
            className={`hamshira__act ${recording ? 'hamshira__act--rec' : ''}`}
            disabled={busy || !data?.voice_enabled || voiceLeft <= 0}
            onClick={() => void toggleRecording()}
            aria-label={uz.assistant.recordVoice}
            title={voiceLeft <= 0 ? uz.assistant.voiceLimit : uz.assistant.recordVoice}
          >
            {recording ? '⏹' : '🎤'}
          </button>
          <button
            type="button"
            className="hamshira__act hamshira__act--send"
            disabled={busy || draft.trim().length < 2}
            onClick={() => void send()}
            aria-label={uz.assistant.send}
          >
            ➤
          </button>
        </div>
      </aside>
    </>
  )
}
