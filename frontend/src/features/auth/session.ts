import { configureAuth } from '@/lib/http';
import { queryClient } from '@/lib/queryClient';

import { revokeSessionToken } from './api';
import { getSessionToken, useAuthStore } from './useAuthStore';

/**
 * Liga o cliente HTTP à sessão: token em toda requisição autenticada e
 * tratamento do 401. Chamado uma única vez, no bootstrap da aplicação.
 */
export function wireAuthSession(): void {
  configureAuth({
    getToken: getSessionToken,
    onUnauthorized: () => {
      // Já deslogado: o 401 é de uma requisição que sobrou, não há o que fazer.
      if (useAuthStore.getState().session === null) return;
      useAuthStore.getState().signOut('expired');
      queryClient.clear();
    },
  });
}

/**
 * Encerra a sessão local e pede a revogação do token.
 *
 * A ordem importa: a revogação é disparada **antes** de limpar o store porque
 * o cabeçalho `Authorization` é montado de forma síncrona — depois da limpeza
 * não haveria token para revogar. O cache do TanStack Query também sai, para
 * a próxima sessão não herdar dados da anterior.
 */
export function endSession(): void {
  void revokeSessionToken();
  useAuthStore.getState().signOut('manual');
  queryClient.clear();
}
