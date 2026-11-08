import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import Icon from '../../Icon.tsx'
import {
  SignInRequired,
  confirmSignedIn,
  getAccessToken,
  signOut,
  startSignIn,
  subscribeToSignOut,
  tryAutomaticSignIn,
} from '../forum/auth.ts'
import { fetchLectureSnapshot } from '../discovery/lectureApi.ts'
import type { LectureSnapshot } from '../discovery/types.ts'
import {
  USERNAME_PATTERN,
  getProfile,
  loadLocalTopics,
  saveLocalTopics,
  saveTopics,
  saveUsername,
} from './profileApi.ts'
import './profile.css'

const PROFILE_PATH = '/profile'

type Account =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn' }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// Older snapshots publish topics only on modules, not as a list in index.json.
function availableTopics(snapshot: LectureSnapshot): string[] {
  if (snapshot.index.topics?.length) return snapshot.index.topics
  return [...new Set(snapshot.modules.flatMap((module) => module.topics ?? []))]
}

function ProfileHeading() {
  return (
    <header className="page-heading">
      <p className="eyebrow">Your space</p>
      <h1>Profile</h1>
      <p>A little about you. A world of things to discover.</p>
    </header>
  )
}

const SIDEBAR_TOPICS = 5

function TopicOrder({
  topics,
  onMove,
  onRemove,
}: {
  topics: string[]
  onMove: (from: number, to: number) => void
  onRemove: (topic: string) => void
}) {
  const list = useRef<HTMLOListElement>(null)
  const [dragged, setDragged] = useState<number | null>(null)

  // Moving a topic to the top or bottom disables the button just pressed;
  // keep focus on that topic's other arrow so the keyboard isn't lost.
  function move(index: number, to: number, direction: 'up' | 'down') {
    onMove(index, to)
    requestAnimationFrame(() => {
      const row = list.current?.children[to]
      const same = row?.querySelector<HTMLButtonElement>(`.move-${direction}`)
      const other = row?.querySelector<HTMLButtonElement>(
        `.move-${direction === 'up' ? 'down' : 'up'}`,
      )
      ;(same && !same.disabled ? same : other)?.focus()
    })
  }

  return (
    <div className="topic-order">
      <h3 id="topic-order-heading">Your topics</h3>
      <p className="profile-hint">
        Drag or use the arrows to reorder. The first {SIDEBAR_TOPICS} appear in
        the sidebar.
      </p>
      <ol ref={list} aria-labelledby="topic-order-heading">
        {topics.map((topic, index) => (
          <li
            key={topic}
            draggable
            className={[
              index < SIDEBAR_TOPICS ? 'is-featured' : '',
              dragged === index ? 'is-dragging' : '',
            ].join(' ')}
            onDragStart={(event) => {
              setDragged(index)
              event.dataTransfer.effectAllowed = 'move'
              // Firefox only starts a drag when some data is set.
              event.dataTransfer.setData('text/plain', topic)
            }}
            onDragOver={(event) => {
              if (dragged === null) return
              event.preventDefault()
              if (dragged !== index) {
                onMove(dragged, index)
                setDragged(index)
              }
            }}
            onDrop={(event) => event.preventDefault()}
            onDragEnd={() => setDragged(null)}
          >
            <Icon name="grip" className="topic-grip" />
            <span className="topic-rank">{index + 1}</span>
            <span className="topic-name">{topic}</span>
            <button
              type="button"
              className="icon-button move-up"
              aria-label={`Move ${topic} up`}
              disabled={index === 0}
              onClick={() => move(index, index - 1, 'up')}
            >
              <Icon name="up" />
            </button>
            <button
              type="button"
              className="icon-button move-down"
              aria-label={`Move ${topic} down`}
              disabled={index === topics.length - 1}
              onClick={() => move(index, index + 1, 'down')}
            >
              <Icon name="down" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${topic}`}
              onClick={() => onRemove(topic)}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ProfilePage() {
  const [account, setAccount] = useState<Account>({ status: 'loading' })
  const [topics, setTopics] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loadError, setLoadError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [username, setUsername] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameState, setUsernameState] = useState<SaveState>('idle')
  const [usernameError, setUsernameError] = useState('')
  // Saves run one at a time, always sending the latest selection.
  const pendingSave = useRef<string[] | null>(null)
  const saving = useRef(false)

  // Signed out, topics are picked and saved in this browser.
  function showSignedOut() {
    setSelected(loadLocalTopics())
    setSaveState('idle')
    setAccount({ status: 'signedOut' })
  }

  useEffect(() => {
    fetchLectureSnapshot()
      .then((snapshot) => setTopics(availableTopics(snapshot)))
      .catch(() => setTopics([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    const signInController = new AbortController()
    const stopSignOut = subscribeToSignOut(() => {
      cancelled = true
      signInController.abort()
      showSignedOut()
    })

    getProfile(getAccessToken)
      .then((profile) => {
        if (cancelled) return
        confirmSignedIn()
        // First sign-in after picking topics signed out: keep those picks.
        const local = loadLocalTopics()
        if (profile.topics.length === 0 && local.length > 0) {
          setSelected(local)
          saveTopics(local, getAccessToken)
            .then(() => setSaveState('saved'))
            .catch(() => {
              setSaveState('error')
              setSaveError('could not copy your topics to your account')
            })
        } else {
          setSelected(profile.topics)
        }
        setUsername(profile.username)
        setUsernameInput(profile.username)
        setAccount({ status: 'signedIn' })
      })
      .catch(async (error: unknown) => {
        if (cancelled) return
        if (!(error instanceof SignInRequired)) {
          // Signed in, but the profile could not be read.
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load profile',
          )
          setAccount({ status: 'signedIn' })
          return
        }
        try {
          // Another tab may be signed in; this redirects to restore the session.
          const started = await tryAutomaticSignIn(
            PROFILE_PATH,
            signInController.signal,
          )
          if (!cancelled && !started) showSignedOut()
        } catch {
          if (!cancelled) showSignedOut()
        }
      })

    return () => {
      cancelled = true
      signInController.abort()
      stopSignOut()
    }
  }, [])

  async function flushSaves() {
    if (saving.current) return
    saving.current = true
    setSaveState('saving')
    try {
      while (pendingSave.current) {
        const next = pendingSave.current
        pendingSave.current = null
        await saveTopics(next, getAccessToken)
      }
      setSaveState('saved')
      setSaveError('')
    } catch (error) {
      if (error instanceof SignInRequired) {
        showSignedOut()
        return
      }
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'Unable to save')
    } finally {
      saving.current = false
    }
  }

  async function submitUsername(event: FormEvent) {
    event.preventDefault()
    const next = usernameInput.trim()
    if (next === username) return
    if (!USERNAME_PATTERN.test(next)) {
      setUsernameState('error')
      setUsernameError(
        'Use 3–20 letters, numbers, underscores or hyphens, without spaces.',
      )
      return
    }
    setUsernameState('saving')
    try {
      const profile = await saveUsername(next, getAccessToken)
      setUsername(profile.username)
      setUsernameInput(profile.username)
      setUsernameState('saved')
      setUsernameError('')
    } catch (error) {
      if (error instanceof SignInRequired) {
        setAccount({ status: 'signedOut' })
        return
      }
      setUsernameState('error')
      setUsernameError(
        error instanceof Error ? error.message : 'Unable to save username',
      )
    }
  }

  function saveSelection(next: string[]) {
    setSelected(next)
    if (account.status === 'signedOut') {
      saveLocalTopics(next)
      setSaveState('saved')
      return
    }
    pendingSave.current = next
    void flushSaves()
  }

  // New picks go to the end; the order is kept and shown in the sidebar.
  function toggleTopic(topic: string) {
    saveSelection(
      selected.includes(topic)
        ? selected.filter((item) => item !== topic)
        : [...selected, topic],
    )
  }

  function moveTopic(from: number, to: number) {
    if (to < 0 || to >= selected.length || from === to) return
    const next = [...selected]
    const [topic] = next.splice(from, 1)
    next.splice(to, 0, topic)
    saveSelection(next)
  }

  if (account.status === 'loading') {
    return (
      <main className="profile-page">
        <ProfileHeading />
        <p aria-live="polite">Loading…</p>
      </main>
    )
  }

  const saveText = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Not saved (${saveError})`,
  }[saveState]

  const topicsPanel = (
    <section className="panel" aria-labelledby="profile-topics">
      <div className="profile-heading">
        <h2 id="profile-topics">Interested topics</h2>
        <span
          className={`profile-save ${saveState === 'error' ? 'is-error' : ''}`}
          aria-live="polite"
        >
          {saveText}
        </span>
      </div>
      {loadError && (
        <p className="status-message">
          Your saved topics could not be loaded ({loadError}).
        </p>
      )}
      {topics === null ? (
        <p aria-live="polite">Loading topics…</p>
      ) : topics.length === 0 ? (
        <p>Topics will appear after the next lecture data update.</p>
      ) : (
        <>
          <p>Select every topic you would like to see lectures about.</p>
          <div
            className="topic-buttons"
            role="group"
            aria-label="Interested topics"
          >
            {topics.map((topic) => (
              <button
                key={topic}
                type="button"
                className="topic-button"
                aria-pressed={selected.includes(topic)}
                onClick={() => toggleTopic(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <TopicOrder
              topics={selected}
              onMove={moveTopic}
              onRemove={toggleTopic}
            />
          )}
          <p className="profile-summary">
            {selected.length === 1
              ? '1 topic selected'
              : `${selected.length} topics selected`}
            {selected.length > 0 && (
              <>
                {' · '}
                <Link to="/?mine=1">Find lectures on my topics</Link>
              </>
            )}
          </p>
        </>
      )}
    </section>
  )

  if (account.status === 'signedOut') {
    return (
      <main className="profile-page">
        <ProfileHeading />
        <section className="panel profile-signin">
          <span className="profile-avatar" aria-hidden="true">
            <Icon name="user" />
          </span>
          <h2>Log in or sign up</h2>
          <p>
            Your topics below are saved in this browser. Log in to keep them on
            every device and to post in the Forum.
          </p>
          <button type="button" onClick={() => void startSignIn(PROFILE_PATH)}>
            Log in or sign up
          </button>
          <p className="profile-hint">
            New here? Choose “Sign up” on the next page and use your @u.nus.edu
            email.
          </p>
        </section>
        {topicsPanel}
      </main>
    )
  }

  return (
    <main className="profile-page">
      <ProfileHeading />
      <section className="panel" aria-labelledby="profile-username">
        <h2 id="profile-username">Username</h2>
        <p>
          Other students see this name on your Forum messages. Your email is
          never shown.
        </p>
        <form className="username-form" onSubmit={submitUsername}>
          <label>
            Username
            <input
              value={usernameInput}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => {
                setUsernameInput(event.target.value)
                setUsernameState('idle')
              }}
            />
          </label>
          <button
            type="submit"
            disabled={
              usernameState === 'saving' || usernameInput.trim() === username
            }
          >
            {usernameState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </form>
        <p
          className={`profile-save ${usernameState === 'error' ? 'is-error' : ''}`}
          aria-live="polite"
        >
          {usernameState === 'saved'
            ? 'Saved. New messages will show this name.'
            : usernameState === 'error'
              ? usernameError
              : ''}
        </p>
      </section>
      {topicsPanel}
      <button
        type="button"
        className="secondary"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </main>
  )
}

export default ProfilePage
