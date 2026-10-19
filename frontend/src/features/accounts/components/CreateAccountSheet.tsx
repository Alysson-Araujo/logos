import { Info } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCreateAccount } from '../hooks/useAccountMutations';
import {
  ACCOUNT_ROLE_OPTIONS,
  ROLE_HELP_TEXT,
  describeCreateAccountError,
  isInviteDeliveryFailure,
  roleOptionLabel,
} from '../labels';
import { createAccountFormSchema, type AccountFieldIssue } from '../schemas';
import type { AccountRole, InvitedAccount } from '../types';

export interface CreateAccountSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (invited: InvitedAccount) => void;
  /**
   * A conta foi criada e o e-mail não saiu.
   *
   * Acontece depois do `201` do ponto de vista do banco, então a tela precisa
   * tratar como um estado próprio: fechar o painel, mostrar a conta na lista e
   * oferecer "Reenviar convite". Deixar o formulário aberto com um erro
   * convidaria a enviar de novo, e isso bateria em `EMAIL_ALREADY_EXISTS`.
   */
  onDeliveryFailed: (email: string) => void;
}

const DEFAULT_ROLE: AccountRole = 'REPORTER';

const EMAIL_HELP_ID = 'conta-email-ajuda';
const EMAIL_ERROR_ID = 'conta-email-erro';
const ROLE_ERROR_ID = 'conta-papel-erro';
const FORM_ERROR_ID = 'conta-form-erro';

/**
 * Painel de nova conta (frame `Admin · contas — nova conta`), 672 px à direita.
 *
 * Sobre o formulário: o campo **não** restringe domínio. A API aceita qualquer
 * endereço com formato válido, e a ajuda do frame ("O convite vai para este
 * endereço.") diz exatamente isso — a versão anterior, que falava em e-mail
 * corporativo, foi corrigida no design.
 */
export function CreateAccountSheet({
  open,
  onClose,
  onCreated,
  onDeliveryFailed,
}: CreateAccountSheetProps) {
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState<string>('');
  const [role, setRole] = useState<AccountRole>(DEFAULT_ROLE);
  const [validation, setValidation] = useState<AccountFieldIssue | null>(null);

  const createMutation = useCreateAccount();
  const isPending = createMutation.isPending;

  // O erro da API é derivado do estado da mutação: assim a mensagem do 409
  // aparece no campo e desaparece quando a pessoa corrige o e-mail.
  const apiIssue =
    createMutation.error === null ? null : describeCreateAccountError(createMutation.error);
  const issue = validation ?? apiIssue;

  const emailError = issue?.field === 'email' ? issue.message : null;
  const roleError = issue?.field === 'role' ? issue.message : null;
  const formError = issue !== null && issue.field === null ? issue.message : null;

  const resetForm = (): void => {
    setEmail('');
    setRole(DEFAULT_ROLE);
    setValidation(null);
    createMutation.reset();
  };

  /** Fechar sempre limpa: reabrir não pode trazer o rascunho da tentativa anterior. */
  const closeSheet = (): void => {
    resetForm();
    onClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending) return;

    createMutation.reset();
    const parsed = createAccountFormSchema.safeParse({ email, role });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path[0] === 'role' ? 'role' : 'email';
      setValidation({ field, message: firstIssue?.message ?? 'Dados inválidos.' });
      if (field === 'email') emailRef.current?.focus();
      return;
    }

    setValidation(null);
    createMutation.mutate(
      { email: parsed.data.email, role: parsed.data.role },
      {
        onSuccess: (invited) => {
          resetForm();
          onCreated(invited);
        },
        onError: (error) => {
          // A conta foi criada e só o e-mail falhou: não é erro de formulário.
          // Fecha o painel e deixa a lista mostrar a conta, com o caminho de
          // recuperação ("Reenviar convite") na linha dela.
          if (isInviteDeliveryFailure(error)) {
            const falhou = parsed.data.email;
            resetForm();
            onDeliveryFailed(falhou);
          }
          // Os demais erros viram campo do formulário no próximo render.
        },
      },
    );
  };

  const handleOpenChange = (next: boolean): void => {
    if (next) return;
    closeSheet();
  };

  const describedByEmail = [EMAIL_HELP_ID, emailError === null ? null : EMAIL_ERROR_ID]
    .filter((id): id is string => id !== null)
    .join(' ');

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent
        className="w-[672px] max-w-full"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          emailRef.current?.focus();
        }}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="flex flex-col gap-1">
              <p className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-subtle">
                NOVA CONTA
              </p>
              <DrawerTitle className="text-lg font-semibold">Criar conta de acesso</DrawerTitle>
              <DrawerDescription>
                A pessoa recebe uma senha temporária por e-mail e define a definitiva no primeiro
                acesso.
              </DrawerDescription>
            </div>
            <DrawerCloseButton label="Fechar a criação de conta" onClose={closeSheet} />
          </header>

          <form
            noValidate
            aria-busy={isPending}
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              {formError === null ? null : (
                <div
                  id={FORM_ERROR_ID}
                  role="alert"
                  className="rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger-text"
                >
                  {formError}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="conta-email" className="text-sm font-medium text-fg">
                  E-mail{' '}
                  <span aria-hidden="true" className="text-danger">
                    *
                  </span>
                </label>
                <Input
                  id="conta-email"
                  ref={emailRef}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="nome.sobrenome@demo.example.com"
                  value={email}
                  disabled={isPending}
                  required
                  aria-invalid={emailError !== null}
                  aria-describedby={describedByEmail}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setValidation(null);
                    createMutation.reset();
                  }}
                />
                <p id={EMAIL_HELP_ID} className="text-2xs text-fg-muted">
                  O convite vai para este endereço.
                </p>
                {emailError === null ? null : (
                  <p
                    id={EMAIL_ERROR_ID}
                    role="alert"
                    className="text-2xs font-medium text-danger-text"
                  >
                    {emailError}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="conta-papel" className="text-sm font-medium text-fg">
                  Papel{' '}
                  <span aria-hidden="true" className="text-danger">
                    *
                  </span>
                </label>
                <Select
                  value={role}
                  disabled={isPending}
                  onValueChange={(value: string) => {
                    const option = ACCOUNT_ROLE_OPTIONS.find((candidate) => candidate === value);
                    if (option !== undefined) setRole(option);
                    setValidation(null);
                    createMutation.reset();
                  }}
                >
                  <SelectTrigger
                    id="conta-papel"
                    className="w-full"
                    aria-invalid={roleError !== null}
                    aria-describedby={roleError === null ? undefined : ROLE_ERROR_ID}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {roleOptionLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-fg-muted">{ROLE_HELP_TEXT}</p>
                {roleError === null ? null : (
                  <p
                    id={ROLE_ERROR_ID}
                    role="alert"
                    className="text-2xs font-medium text-danger-text"
                  >
                    {roleError}
                  </p>
                )}
              </div>

              <div className="flex items-start gap-2 rounded-sm bg-info-soft px-3 py-3 text-sm text-info-text">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  A senha temporária é gerada pelo sistema, enviada para este e-mail e expira em 24
                  horas. No primeiro acesso a pessoa define a definitiva.
                </p>
              </div>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
              <p className="text-2xs text-fg-muted">
                O convite fica pendente até o primeiro acesso
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={closeSheet} disabled={isPending}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={isPending}>
                  {isPending ? 'Enviando…' : 'Enviar convite'}
                </Button>
              </div>
            </footer>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
