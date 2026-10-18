import { CircleAlert, CircleCheckBig, LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { useChangePassword } from '../hooks/useChangePassword';
import { describeChangePasswordError, PASSWORD_CHANGED, PASSWORD_POLICY_HINT } from '../labels';
import { changePasswordFormSchema, type ChangePasswordFormValues } from '../schemas';

type InvalidField = keyof ChangePasswordFormValues;

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELD_IDS: Record<InvalidField, string> = {
  currentPassword: 'troca-senha-atual',
  newPassword: 'troca-senha-nova',
  confirmPassword: 'troca-senha-confirmar',
};

const ERROR_ID = 'troca-senha-erro';

/**
 * Troca de senha — mesma composição do frame `Primeiro acesso · definir senha`
 * (seção `Primeiro acesso`), com a senha atual a mais: aqui a pessoa já está
 * autenticada, então a API exige a senha vigente
 * (`POST /auth/change-password`).
 *
 * A política exibida é a que a API aplica de verdade (`app/domain/accounts.py`):
 * mínimo de 12 caracteres, sem exigir símbolo, maiúscula ou dígito. Inventar
 * requisito aqui faria a interface recusar senha que o servidor aceita.
 */
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ field: InvalidField; message: string } | null>(
    null,
  );
  const change = useChangePassword();

  const apiMessage = change.isError ? describeChangePasswordError(change.error) : null;
  const invalidField = fieldError?.field ?? null;

  const reset = (): void => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFieldError(null);
    change.reset();
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFieldError(null);

    const parsed = changePasswordFormSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = (issue?.path[0] ?? 'newPassword') as InvalidField;
      setFieldError({ field, message: issue?.message ?? 'Revise os campos.' });
      return;
    }

    change.mutate({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
  };

  const isDone = change.isSuccess;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogTitle>Trocar senha</DialogTitle>
        <DialogDescription>Confirme a senha atual e escolha a nova.</DialogDescription>

        {isDone ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-sm bg-success-soft px-3 py-3 text-sm text-success-text"
          >
            <CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{PASSWORD_CHANGED}</p>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg" htmlFor={FIELD_IDS.currentPassword}>
                Senha atual
              </label>
              <Input
                id={FIELD_IDS.currentPassword}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                }}
                aria-invalid={invalidField === 'currentPassword'}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg" htmlFor={FIELD_IDS.newPassword}>
                Nova senha
              </label>
              <Input
                id={FIELD_IDS.newPassword}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
                aria-invalid={invalidField === 'newPassword'}
              />
              <p className="text-2xs text-fg-muted">{PASSWORD_POLICY_HINT}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg" htmlFor={FIELD_IDS.confirmPassword}>
                Confirmar nova senha
              </label>
              <Input
                id={FIELD_IDS.confirmPassword}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
                aria-invalid={invalidField === 'confirmPassword'}
              />
            </div>

            {fieldError === null && apiMessage === null ? null : (
              <div
                id={ERROR_ID}
                role="alert"
                className="flex items-center gap-2 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger-text"
              >
                <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{fieldError?.message ?? apiMessage}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  handleOpenChange(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={change.isPending}
                aria-busy={change.isPending}
              >
                {change.isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  'Salvar nova senha'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
