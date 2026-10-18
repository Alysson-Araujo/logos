import { ChevronDown, Lock, LogOut } from 'lucide-react';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChangePasswordDialog } from '@/features/auth/components/ChangePasswordDialog';
import { formatSessionLabel, initialsFromName } from '@/features/auth/labels';
import { endSession } from '@/features/auth/session';
import { useAuthStore } from '@/features/auth/useAuthStore';

/**
 * Área do usuário no cabeçalho — frame `Logoff · menu do usuário` (seção
 * `Acesso · logoff`). Antes daqui havia um botão "Sair" solto ao lado do nome.
 *
 * O `DropdownMenu` do Radix resolve o que é chato de fazer à mão: foco preso
 * enquanto aberto, `Esc`, clique fora, devolução do foco ao gatilho e
 * navegação por setas. O menu mostra nome **e** e-mail porque quem opera a
 * central costuma ter mais de uma conta aberta na mesma máquina — e o papel
 * continua visível no gatilho, que é o que a triagem precisa saber de relance.
 */
export function UserMenu() {
  const user = useAuthStore((state) => state.session?.user ?? null);
  const [isChangingPassword, setChangingPassword] = useState(false);

  if (user === null) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Abrir menu do usuário"
            className="inline-flex items-center gap-2 rounded-sm border-l border-border py-1 pl-3 pr-2 text-2xs text-fg-muted outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-sunken font-semibold text-fg"
            >
              {initialsFromName(user.name)}
            </span>
            <span className="hidden md:inline">{formatSessionLabel(user)}</span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-fg">{user.name}</p>
            <p className="text-2xs text-fg-muted">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setChangingPassword(true);
            }}
          >
            <Lock className="h-4 w-4 text-fg-muted" aria-hidden="true" />
            Trocar senha
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-danger"
            onSelect={() => {
              endSession();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Montado só quando aberto: o diálogo usa o `useMutation`, que exige o
          `QueryClient`. Montá-lo sempre obrigaria o cabeçalho inteiro a viver
          dentro do provedor só por causa de um menu. */}
      {isChangingPassword ? <ChangePasswordDialog open onOpenChange={setChangingPassword} /> : null}
    </>
  );
}
