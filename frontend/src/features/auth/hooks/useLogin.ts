import { useMutation } from '@tanstack/react-query';

import type { ApiError } from '@/lib/http';

import { login } from '../api';
import type { AuthSession, LoginCredentials } from '../types';
import { useAuthStore } from '../useAuthStore';

/**
 * Login como mutação: **sem retry automático** (senha errada não melhora na
 * segunda tentativa) e com o erro tipado à disposição da tela, que decide a
 * mensagem por código.
 */
export function useLogin() {
  const signIn = useAuthStore((state) => state.signIn);

  return useMutation<AuthSession, ApiError, LoginCredentials>({
    mutationFn: (credentials) => login(credentials),
    onSuccess: (session) => {
      signIn(session);
    },
  });
}
