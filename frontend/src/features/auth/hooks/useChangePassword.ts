import { useMutation } from '@tanstack/react-query';

import type { ApiError } from '@/lib/http';

import { changePassword, type ChangePasswordPayload } from '../api';

/**
 * Troca de senha como mutação, **sem retry**: senha atual errada não melhora na
 * segunda tentativa, e repetir o envio só gasta o teto de requisições da API.
 * O erro fica tipado para a tela decidir a mensagem por código.
 */
export function useChangePassword() {
  // `TData` é `void` de verdade: a API responde 204 sem corpo. A regra
  // `no-invalid-void-type` do projeto não aceita `void` neste genérico, daí a
  // dispensa — trocar por `undefined` só maquiaría o tipo.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  return useMutation<void, ApiError, ChangePasswordPayload>({
    mutationFn: (payload) => changePassword(payload),
  });
}
