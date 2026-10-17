import { create } from 'zustand';

import { LOGIN_SESSION_EXPIRED } from './labels';
import { storedSessionSchema, toAuthUser } from './schemas';
import type { AuthSession, SignOutReason } from './types';

/**
 * `sessionStorage`, e não `localStorage`.
 *
 * O frame de login não tem "lembrar-me" e o token é do tamanho da aba:
 * recarregar mantém a sessão, fechar encerra. É o que reduz a exposição a XSS
 * sem esconder o custo — o token é acessível por JavaScript, e isso está
 * registrado no README.
 */
const SESSION_STORAGE_KEY = 'logos-session';

/** `null` quando não há storage (ambiente sem DOM, modo privado, bloqueio). */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function clearStoredSession(): void {
  try {
    storage()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nada a fazer: a sessão em memória já foi limpa.
  }
}

function persistSession(session: AuthSession): void {
  try {
    storage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Persistir é conveniência: falhar aqui não derruba o login.
  }
}

/**
 * Reconstrói a sessão a partir da aba, descartando o que não serve: JSON
 * inválido, formato desconhecido ou token já vencido.
 */
function readStoredSession(): AuthSession | null {
  const store = storage();
  if (store === null) return null;

  try {
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (raw === null) return null;

    const parsed = storedSessionSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      clearStoredSession();
      return null;
    }

    const { accessToken, tokenType, expiresIn, expiresAt, user } = parsed.data;
    if (expiresAt <= Date.now()) {
      clearStoredSession();
      return null;
    }

    return { accessToken, tokenType, expiresIn, expiresAt, user: toAuthUser(user) };
  } catch {
    return null;
  }
}

interface AuthStoreState {
  session: AuthSession | null;
  /** Mensagem para a tela de login (sessão expirada, por exemplo). */
  notice: string | null;
  signIn: (session: AuthSession) => void;
  signOut: (reason?: SignOutReason) => void;
  consumeNotice: () => void;
}

/**
 * A leitura do storage acontece uma única vez, na carga do módulo: recarregar
 * a aba restaura a sessão sem nenhuma chamada de rede.
 */
export const useAuthStore = create<AuthStoreState>()((set) => ({
  session: readStoredSession(),
  notice: null,
  signIn: (session) => {
    persistSession(session);
    set({ session, notice: null });
  },
  signOut: (reason = 'manual') => {
    clearStoredSession();
    set({ session: null, notice: reason === 'expired' ? LOGIN_SESSION_EXPIRED : null });
  },
  consumeNotice: () => {
    set({ notice: null });
  },
}));

/** Token atual lido fora do React — é o que o cliente HTTP consulta. */
export function getSessionToken(): string | null {
  return useAuthStore.getState().session?.accessToken ?? null;
}
