import { CircleAlert, LoaderCircle, LogIn } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { DEMO_ACCOUNTS_BY_ROLE, DEMO_CREDENTIALS, DEMO_INVITE_LABEL } from '../demo';
import { useLogin } from '../hooks/useLogin';
import { describeLoginError } from '../labels';
import { loginFormSchema } from '../schemas';
import { useAuthStore } from '../useAuthStore';
import { LoginMap } from './LoginMap';

type InvalidField = 'email' | 'password';

interface FieldError {
  field: InvalidField;
  message: string;
}

const ERROR_ID = 'login-error';

/**
 * Depois deste tempo a requisição já saiu e o que falta é a API responder.
 * Trocamos o texto para a pessoa saber que o trabalho agora é do outro lado —
 * é a diferença entre "está pensando" e "já foi, estou te levando".
 */
const REDIRECT_HINT_MS = 700;

/**
 * Tela de login — porte do frame `Login · mapa` (seção `Login · mapa`).
 *
 * Dois painéis: mapa vetorial de 880 px à esquerda, formulário de 416 px à
 * direita. O mapa **desaparece** num degradê até a cor da página, então o
 * formulário não tem moldura de card: ele assenta direto no fundo.
 *
 * Abaixo de `lg` o mapa sai de cena — em 390 px ele roubaria o espaço do
 * formulário. O mesmo desenho serve aos dois temas: o mapa é a "imagem" e o
 * degradê acompanha os tokens.
 */
export function LoginScreen() {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // O frame mostra os campos preenchidos com a credencial de demonstração:
  // a tela abre pronta para entrar com um clique.
  const [email, setEmail] = useState<string>(DEMO_CREDENTIALS.email);
  const [password, setPassword] = useState<string>(DEMO_CREDENTIALS.password);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const loginMutation = useLogin();
  const notice = useAuthStore((state) => state.notice);
  const consumeNotice = useAuthStore((state) => state.consumeNotice);

  const isPending = loginMutation.isPending;
  const apiMessage = loginMutation.error === null ? null : describeLoginError(loginMutation.error);
  const message = fieldError?.message ?? apiMessage ?? notice;
  const invalidField = fieldError?.field ?? null;

  // Sinaliza a troca de fase: a requisição saiu, falta o redirecionamento.
  useEffect(() => {
    if (!isPending) {
      setIsRedirecting(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsRedirecting(true);
    }, REDIRECT_HINT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isPending]);

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

  const rotuloBotao = isRedirecting ? 'Abrindo a central…' : 'Entrando…';

  return (
    <div className="relative flex min-h-dvh bg-bg">
      {/* Painel do mapa: decoração. Some abaixo de lg. */}
      <div className="relative hidden w-[880px] shrink-0 overflow-hidden lg:block">
        <LoginMap />
        {/* O mapa entrega o lugar para o formulário sem linha de corte. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-[435px] bg-gradient-to-r from-transparent to-bg"
        />
      </div>

      <div className="absolute right-11 top-8 z-10">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <form
          noValidate
          aria-busy={isPending}
          onSubmit={handleSubmit}
          className="flex w-[416px] max-w-full flex-col gap-6"
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

          <div className="flex flex-col gap-2">
            {/* Barra indeterminada: comunica "o pedido saiu" sem fingir progresso. */}
            {isPending ? (
              <div
                aria-hidden="true"
                className="h-0.5 w-full overflow-hidden rounded-full bg-accent/15"
              >
                <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-bar-slide" />
              </div>
            ) : null}

            <Button type="submit" variant="primary" className="w-full">
              {isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {rotuloBotao}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Entrar
                </>
              )}
            </Button>
          </div>

          {/* O botão não é região viva: a fase é anunciada por aqui. */}
          <span role="status" aria-live="polite" className="sr-only">
            {isPending
              ? isRedirecting
                ? 'Requisição enviada. Abrindo a central.'
                : 'Enviando credenciais.'
              : ''}
          </span>

          <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3">
            <p className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-muted">
              Acesso de demonstração
            </p>
            {DEMO_ACCOUNTS_BY_ROLE.map((group) => (
              <div key={group.role} className="flex flex-col gap-1">
                <p className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-subtle">
                  {group.role}
                </p>
                {/* Grid de duas colunas, e não uma linha com espaços fixos: o
                    alinhamento não pode depender do comprimento do e-mail, que
                    varia de 15 a 28 caracteres. A coluna do e-mail absorve a
                    sobra e trunca; a da senha fica com a largura do conteúdo —
                    igual para todas as linhas do grupo.

                    `<dl>`/`<dt>`/`<dd>` porque é exatamente isto: um termo e a
                    sua descrição — credencial e senha. */}
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1">
                  {group.accounts.map((account) => (
                    <Fragment key={account.email}>
                      <dt className="truncate font-mono text-2xs text-fg-muted">{account.email}</dt>
                      <dd
                        className={cn(
                          'text-right font-mono text-2xs',
                          account.password === null
                            ? 'italic text-fg-subtle'
                            : 'font-medium text-fg',
                        )}
                      >
                        {account.password ?? DEMO_INVITE_LABEL}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            ))}
            <p className="text-2xs leading-relaxed text-fg-muted">
              A conta ADMIN abre &quot;Contas de acesso&quot; no menu do usuário. A do convite
              pendente entra com a senha temporária, que o &quot;Reenviar&quot; gera de novo.
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
