import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ApiError } from '@/lib/http';

import { changePassword } from '../api';
import type { ChangePasswordPayload } from '../types';
import { useAuthStore } from '../useAuthStore';

/**
 * Troca de senha como mutação, **sem retry** — senha atual errada não melhora na
 * segunda tentativa, e repetir o envio só gasta o teto de requisições da API.
 * O erro fica tipado para a tela decidir a mensagem por código.
 *
 * O mesmo hook serve aos dois fluxos: o diálogo de troca voluntária do menu
 * (#126), que manda a senha atual digitada, e a tela de primeiro acesso do
 * convite (#128), que manda a temporária guardada em memória. O que muda é só
 * o que a tela envia em `currentPassword`.
 *
 * No sucesso, a sessão perde `mustChangePassword` — inofensivo quando já era
 * `false` — e o cache do TanStack Query é limpo **se** a troca era obrigatória:
 * as respostas anteriores vinham de uma sessão que ainda não podia usar a API e
 * reaproveitá-las mostraria erro de permissão na triagem recém-liberada.
 */
export function useChangePassword() {
  const completePasswordChange = useAuthStore((state) => state.completePasswordChange);
  const client = useQueryClient();

  // `TData` é `void` de verdade: a API responde 204 sem corpo. A regra
  // `no-invalid-void-type` do projeto não aceita `void` neste genérico, daí a
  // dispensa — trocar por `undefined` só maquiaría o tipo.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  return useMutation<void, ApiError, ChangePasswordPayload>({
    mutationFn: (payload) => changePassword(payload),
    onSuccess: () => {
      const wasForced = useAuthStore.getState().session?.mustChangePassword ?? false;
      completePasswordChange();
      if (wasForced) client.clear();
    },
  });
}
