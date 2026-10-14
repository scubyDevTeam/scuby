import { ApiError } from '@api-client/http'
import { useGoogleSignIn, useStartEmailCode, useVerifyEmailCode } from '@api-client/session'
import {
  CODE_LENGTH,
  cleanCode,
  isCompleteCode,
  isEmail,
  RESEND_COOLDOWN_S,
} from '@domain/shared/signin'
import { requestGoogleCredential } from '@platform/google'
import { GoogleIcon } from '@ui/BrandIcons'
import { Button } from '@ui/Button'
import { TextField } from '@ui/Field'
import { Notice } from '@ui/Notice'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'

type Props = {
  /** Google's client id. Without one, Google is offered only when `demoCode` says this is a demo. */
  googleClientId: string | undefined
  /** Set when the backend is emulated: the code it accepts, shown so the demo can be used. */
  demoCode: string | undefined
  /** Links to the terms and the data policy. */
  legal: ReactNode
}

/**
 * docs/eng/auth.md · Sign-in: two doors, no passwords, no signup screen. Signing in fills the
 * session, and whoever rendered this re-renders with it.
 */
export function SignIn({ googleClientId, demoCode, legal }: Props) {
  const start = useStartEmailCode()
  const verify = useVerifyEmailCode()
  const google = useGoogleSignIn()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [googleFailed, setGoogleFailed] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  function send(event?: FormEvent) {
    event?.preventDefault()
    if (!isEmail(email)) return setEmailError('Revisa tu correo: parece incompleto')
    setEmailError(null)
    const address = email.trim()
    start.mutate(address, {
      onSuccess: () => {
        setSentTo(address)
        setCode('')
        verify.reset()
        setCooldown(RESEND_COOLDOWN_S)
      },
    })
  }

  function typeCode(input: string) {
    const next = cleanCode(input)
    setCode(next)
    // No button to press: the sixth digit sends it.
    if (isCompleteCode(next) && sentTo) verify.mutate({ email: sentTo, code: next })
  }

  async function withGoogle() {
    setGoogleFailed(false)
    const credential = googleClientId ? await requestGoogleCredential(googleClientId) : 'demo'
    if (!credential) return setGoogleFailed(true)
    google.mutate({ credential })
  }

  const wrongCode = verify.error instanceof ApiError && verify.error.kind === 'rejected'

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-muted">
        Necesitamos saber quién eres para que los vecinos puedan contactarte. Sin contraseñas.
      </p>

      {googleClientId || demoCode ? (
        <>
          <Button variant="outline" onClick={withGoogle} disabled={google.isPending}>
            <GoogleIcon />
            {google.isPending ? 'Entrando…' : 'Continuar con Google'}
          </Button>
          {googleFailed || google.isError ? (
            <p role="alert" className="m-0 text-sm font-semibold text-lost-deep">
              No pudimos entrar con Google. Prueba con tu correo.
            </p>
          ) : null}
          <p className="m-0 flex items-center gap-3 text-sm text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            o con tu correo
          </p>
        </>
      ) : null}

      <form onSubmit={send} noValidate className="flex flex-col gap-3">
        <TextField
          label="Correo electrónico"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          error={emailError}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {sentTo ? null : (
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? 'Enviando…' : 'Enviarme un código'}
          </Button>
        )}
        {start.isError ? (
          <Notice tone="warning" title="No pudimos enviar el código.">
            Revisa tu conexión e inténtalo de nuevo.
          </Notice>
        ) : null}
      </form>

      {sentTo ? (
        <div className="flex flex-col gap-3">
          <TextField
            label={`Código de ${CODE_LENGTH} dígitos que te enviamos`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className="min-h-14 w-full rounded-2xl border-2 border-field bg-surface px-4 text-center font-mono text-2xl font-bold tracking-[0.5em] aria-invalid:border-lost"
            hint={`Lo enviamos a ${sentTo}. Si no llega, revisa la carpeta de spam.`}
            error={
              wrongCode
                ? 'Ese código no coincide. Revísalo o pide uno nuevo.'
                : verify.isError
                  ? 'No pudimos comprobar el código. Inténtalo de nuevo.'
                  : null
            }
            disabled={verify.isPending}
            value={code}
            onChange={(event) => typeCode(event.target.value)}
          />
          {demoCode ? (
            <Notice tone="neutral" title="Modo demostración.">
              No se envía ningún correo: usa el código {demoCode}.
            </Notice>
          ) : null}
          <Button
            variant="link"
            className="self-start"
            disabled={cooldown > 0 || start.isPending}
            onClick={() => send()}
          >
            {cooldown > 0 ? `Reenviar código en ${cooldown} s` : 'Reenviar código'}
          </Button>
        </div>
      ) : null}

      <p className="m-0 text-sm text-muted">{legal}</p>
    </div>
  )
}
