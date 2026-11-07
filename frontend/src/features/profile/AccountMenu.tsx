import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import Icon from '../../Icon.tsx'
import {
  SignInRequired,
  getAccessToken,
  signOut,
  startPasswordChange,
  startSignIn,
  subscribeToSignOut,
} from '../forum/auth.ts'
import { getProfile, subscribeToProfileUpdates } from './profileApi.ts'

type Account =
  | { status: 'loading' | 'signedOut' | 'unavailable' }
  | { status: 'signedIn'; username: string }

type AccountAction = 'signIn' | 'signOut' | 'changePassword'

export default function AccountMenu() {
  const { pathname, search, hash } = useLocation()
  const [account, setAccount] = useState<Account>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<AccountAction | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    let cancelled = false
    let profileChanged = false
    const stopSignOut = subscribeToSignOut(() => {
      cancelled = true
      setAccount({ status: 'signedOut' })
      setOpen(false)
    })
    const stopProfileUpdates = subscribeToProfileUpdates((profile) => {
      if (cancelled) return
      profileChanged = true
      setAccount({ status: 'signedIn', username: profile.username })
    })
    getProfile(getAccessToken)
      .then((profile) => {
        if (!cancelled && !profileChanged) {
          setAccount({ status: 'signedIn', username: profile.username })
        }
      })
      .catch((cause: unknown) => {
        if (cancelled || profileChanged) return
        setAccount({
          status: cause instanceof SignInRequired ? 'signedOut' : 'unavailable',
        })
      })
    return () => {
      cancelled = true
      stopSignOut()
      stopProfileUpdates()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  async function authenticate(action: AccountAction) {
    if (busy) return
    setBusy(action)
    setError('')
    try {
      if (action === 'signIn') await startSignIn(`${pathname}${search}${hash}`)
      else if (action === 'changePassword')
        await startPasswordChange(`${pathname}${search}${hash}`)
      else await signOut()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const signedOut = account.status === 'signedOut'
  const username = account.status === 'signedIn' ? account.username : 'Account'

  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="sidebar-account"
        disabled={account.status === 'loading' || busy !== null}
        aria-label={signedOut ? 'Sign in' : `Account options for ${username}`}
        aria-expanded={signedOut ? undefined : open}
        aria-controls={signedOut ? undefined : panelId}
        onClick={() =>
          signedOut ? void authenticate('signIn') : setOpen(!open)
        }
      >
        <span className="account-icon" aria-hidden="true">
          {account.status === 'signedIn' ? (
            username.slice(0, 1).toUpperCase()
          ) : (
            <Icon name="user" />
          )}
        </span>
        <span className="account-label">
          <strong title={signedOut ? undefined : username}>
            {signedOut ? 'Sign in' : username}
          </strong>
          <small>
            {account.status === 'loading'
              ? 'Loading profile…'
              : busy
                ? 'Please wait…'
                : signedOut
                  ? 'Save your interests'
                  : 'Account options'}
          </small>
        </span>
        <Icon name="chevron" />
      </button>
      {open && !signedOut && (
        <div
          className="account-popover"
          id={panelId}
          role="group"
          aria-label="Account options"
        >
          {account.status === 'unavailable' && (
            <p>Your profile couldn’t be loaded.</p>
          )}
          <Link to="/profile" onClick={() => setOpen(false)}>
            <Icon name="user" />
            View profile
          </Link>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void authenticate('changePassword')}
          >
            <Icon name="lock" />
            {busy === 'changePassword' ? 'Opening…' : 'Change password'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void authenticate('signOut')}
          >
            <Icon name="logout" />
            {busy === 'signOut' ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
