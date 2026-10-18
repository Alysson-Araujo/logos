import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { useChangePassword } from '../hooks/useChangePassword';
import {
  CHANGE_PASSWORD_HINT,
  CHANGE_PASSWORD_MISSING_TEMPORARY,
  CHANGE_PASSWORD_POLICY_TEXT,
  CHANGE_PASSWORD_POLICY_TITLE,
  CHANGE_PASSWORD_SUBTITLE,
  describePasswordChangeError,
} from '../labels';
import { firstAccessPasswordFormSchema } from '../schemas';
import { endSession } from '../session';
import { useAuthStore } from '../useAuthStore';

type InvalidField = 'newPassword' | 'confirmPassword';

interface FieldError {
  field: InvalidField;
  message: string;
}

const ERROR_ID = 'senha-error';
const MISSING_ID = 'senha-temporaria-ausente';

/**
 * Primeiro acesso — porte do frame `Primeiro acesso · definir senha` (seção
 * `Admin · contas`).
 *
 * Card de 416 px com padding de 32, `radius/md` e `sombra/e3`, as mesmas
 * medidas do login: as duas telas são o mesmo degrau da entrada, e a pessoa
 * precisa reconhecer o lugar.
 *
 * Desvio consciente: a senha atual não tem campo porque ela já foi digitada no
 * login e fica só em memória. Se a aba for recarregada no meio do fluxo ela se
 * perde, e a tela pede para entrar de novo em vez de mostrar um formulário que
 * a API recusaria — o frame não desenha esse caso.
 */
export function ChangePasswordScreen() {
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [fieldError, setFieldError] = useState<FieldError | null>(null);

  const pendingPassword = useAuthStore((state) => state.pendingPassword);
  const changePasswordMutation = useChangePassword();

  const isPending = changePasswordMutation.isPending;
  const apiMessage =
    changePasswordMutation.error === null
      ? null
      : describePasswordChangeError(changePasswordMutation.error);
  const message = fieldError?.message ?? apiMessage;
  const invalidField = fieldError?.field ?? null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    // O botão desabilita durante o envio, mas o Enter no campo não passa por
    // ele: o guarda contra reenvio fica aqui também.
    if (isPending || pendingPassword === null) return;

    const parsed = firstAccessPasswordFormSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field: InvalidField =
        issue?.path[0] === 'confirmPassword' ? 'confirmPassword' : 'newPassword';
      setFieldError({ field, message: issue?.message ?? 'Dados inválidos.' });
      (field === 'confirmPassword' ? confirmRef : newPasswordRef).current?.focus();
      return;
    }

    setFieldError(null);
    changePasswordMutation.mutate({
      currentPassword: pendingPassword,
      newPassword: parsed.data.newPassword,
    });
  };

  const missingTemporaryPassword = pendingPassword === null;

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
            <p className="text-sm text-fg-muted">{CHANGE_PASSWORD_SUBTITLE}</p>
          </div>

          <div aria-hidden="true" className="h-px w-full bg-border" />

          {missingTemporaryPassword ? (
            <>
              <div
                id={MISSING_ID}
                role="alert"
                className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger-text"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{CHANGE_PASSWORD_MISSING_TEMPORARY}</p>
              </div>
              <Button variant="secondary" className="w-full" onClick={endSession}>
                Sair e entrar de novo
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="senha-nova" className="text-sm font-medium text-fg">
                  Nova senha
                </label>
                <Input
                  id="senha-nova"
                  ref={newPasswordRef}
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  disabled={isPending}
                  aria-invalid={invalidField === 'newPassword'}
                  aria-describedby={
                    invalidField === 'newPassword'
                      ? `${ERROR_ID} senha-nova-dica`
                      : 'senha-nova-dica'
                  }
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                  }}
                />
                <p id="senha-nova-dica" className="text-2xs text-fg-muted">
                  {CHANGE_PASSWORD_HINT}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="senha-confirmar" className="text-sm font-medium text-fg">
                  Confirmar nova senha
                </label>
                <Input
                  id="senha-confirmar"
                  ref={confirmRef}
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  disabled={isPending}
                  aria-invalid={invalidField === 'confirmPassword'}
                  aria-describedby={invalidField === 'confirmPassword' ? ERROR_ID : undefined}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
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

              <div className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
                <p className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-muted">
                  {CHANGE_PASSWORD_POLICY_TITLE}
                </p>
                <p className="text-2xs text-fg">{CHANGE_PASSWORD_POLICY_TEXT}</p>
              </div>

              <Button type="submit" variant="primary" className="w-full" disabled={isPending}>
                {isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  'Salvar e entrar'
                )}
              </Button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
