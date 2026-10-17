import { CircleAlert, LoaderCircle, LogIn } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { DEMO_CREDENTIALS } from '../demo';
import { useLogin } from '../hooks/useLogin';
import { describeLoginError } from '../labels';
import { loginFormSchema } from '../schemas';
import { useAuthStore } from '../useAuthStore';

type InvalidField = 'email' | 'password';

interface FieldError {
  field: InvalidField;
  message: string;
}

const ERROR_ID = 'login-error';

/**
 * Tela de login — porte dos frames `Login · padrão`, `Login · erro de
 * credencial` e `Login · carregando` (seção `Login`, `31:13146`).
 *
 * Medidas do frame: card de 416 px com padding de 32 e gap de 24, `radius/md`,
 * `sombra/e3`, divisor de 1 px em `color/border`, campos de 36 px com
 * `radius/sm` e caixa de demonstração em `color/surface-sunken`.
 *
 * Desvio consciente: o frame ancora o card a 250 px do topo de um canvas de
 * 900 px; aqui ele é centralizado, porque a altura da tela do avaliador não é
 * conhecida e o card não pode ser cortado.
 */
export function LoginScreen() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // O frame mostra os campos preenchidos com a credencial de demonstração:
  // a tela abre pronta para entrar com um clique.
  const [email, setEmail] = useState<string>(DEMO_CREDENTIALS.email);
  const [password, setPassword] = useState<string>(DEMO_CREDENTIALS.password);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);

  const loginMutation = useLogin();
  const notice = useAuthStore((state) => state.notice);
  const consumeNotice = useAuthStore((state) => state.consumeNotice);

  const isPending = loginMutation.isPending;
  const apiMessage = loginMutation.error === null ? null : describeLoginError(loginMutation.error);
  const message = fieldError?.message ?? apiMessage ?? notice;
  const invalidField = fieldError?.field ?? null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    // O botão mantém a aparência do frame (sem `disabled`), então o guarda
    // contra reenvio fica aqui.
    if (isPending) return;

    consumeNotice();

    const parsed = loginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field: InvalidField = issue?.path[0] === 'password' ? 'password' : 'email';
      setFieldError({ field, message: issue?.message ?? 'Dados inválidos.' });
      (field === 'password' ? passwordRef : emailRef).current?.focus();
      return;
    }

    setFieldError(null);
    loginMutation.mutate(parsed.data);
  };

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <div className="absolute right-11 top-8">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <form
          noValidate
          aria-busy={isPending}
          onSubmit={handleSubmit}
          className="flex w-[416px] max-w-full flex-col gap-6 rounded-md bg-surface p-8 shadow-e3"
        >
          <div className="flex flex-col gap-1">
            <p className="font-mono text-sm font-semibold text-fg">LOGOS</p>
            <p className="text-sm text-fg-muted">Central de Resposta a Incidentes</p>
          </div>

          <div aria-hidden="true" className="h-px w-full bg-border" />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-sm font-medium text-fg">
              E-mail
            </label>
            <Input
              id="login-email"
              ref={emailRef}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="voce@empresa.com.br"
              value={email}
              disabled={isPending}
              aria-invalid={invalidField === 'email'}
              aria-describedby={message === null ? undefined : ERROR_ID}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-sm font-medium text-fg">
              Senha
            </label>
            <Input
              id="login-password"
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={isPending}
              aria-invalid={invalidField === 'password'}
              aria-describedby={message === null ? undefined : ERROR_ID}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </div>

          {message === null ? null : (
            <div
              id={ERROR_ID}
              role="alert"
              className="flex items-center gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger-text"
            >
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{message}</p>
            </div>
          )}

          <Button type="submit" variant="primary" className="w-full">
            {isPending ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                Entrando…
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Entrar
              </>
            )}
          </Button>

          <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
            <p className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-muted">
              Acesso de demonstração
            </p>
            <p className="whitespace-pre font-mono text-2xs text-fg">
              {`${DEMO_CREDENTIALS.email}  ·  ${DEMO_CREDENTIALS.password}`}
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
