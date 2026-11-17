import { useId, useState, type FormEvent } from 'react'
import { archive } from '~/archive/store'
import { cs, fill } from '~/copy/cs'
import { SIGN_IN_LOCK_MINUTES } from './limits'

type SignInResult = Awaited<ReturnType<typeof archive.signIn>>

/** Signing in says nothing about where it leads; what the person may do shows after it, by their role. */
export function LoginForm() {
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<SignInResult | 'failed' | null>(null)
  const errorId = useId()

  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const outcome = await archive.signIn(password)
      setResult(outcome)
      if (outcome !== 'ok') setPassword('')
    } catch {
      setResult('failed')
    } finally {
      setBusy(false)
    }
  }

  const error =
    result === 'wrong'
      ? cs.admin.wrongPassword
      : result === 'locked'
        ? fill(cs.admin.locked, { minutes: SIGN_IN_LOCK_MINUTES })
        : result === 'failed'
          ? cs.admin.signInFailed
          : null

  return (
    <form className="login" onSubmit={(event) => void submit(event)}>
      <h1>{cs.admin.loginTitle}</h1>
      <label className="field">
        <span>{cs.admin.passwordLabel}</span>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          required
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the page has a single purpose: this field.
          autoFocus
        />
      </label>
      {error === null ? null : (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button button--primary" disabled={busy}>
        {cs.admin.signIn}
      </button>
    </form>
  )
}
