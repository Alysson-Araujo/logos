import { create } from 'zustand';

import { LOGIN_SESSION_EXPIRED, LOGIN_SIGNED_OUT } from './labels';
import { storedSessionSchema, toAuthUser } from './schemas';
import type { AuthSession, SignOutReason } from './types';

/**
 * `sessionStorage`, e não `localStorage`.
 *
 * O frame de login não tem "lembrar-me" e o token é do tamanho da aba:
 * recarregar mantém a sessão, fechar encerra. É o que reduz a exposição a XSS
 * sem esconder o custo — o token é acessível por JavaScript, e isso está
 * registrado no README. A senha temporária do convite **não** entra aqui: ela
 * fica só em memória e morre com a aba (`pendingPassword`).
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

    const { accessToken, tokenType, expiresIn, expiresAt, mustChangePassword, user } = parsed.data;
    if (expiresAt <= Date.now()) {
      clearStoredSession();
      return null;
    }

    return {
      accessToken,
      tokenType,
      expiresIn,
      expiresAt,
      mustChangePassword,
      user: toAuthUser(user),
    };
  } catch {
    return null;
  }
}

interface AuthStoreState {
  session: AuthSession | null;
  /** Mensagem para a tela de login (sessão expirada, por exemplo). */
  notice: string | null;
  /**
   * Senha temporária digitada no login, guardada **apenas em memória** durante
   * a troca obrigatória. Recarregar a aba a apaga — por isso a tela de definir
   * senha pede sair e entrar de novo quando ela não está aqui.
   */
  pendingPassword: string | null;
  signIn: (session: AuthSession, pendingPassword?: string) => void;
  signOut: (reason?: SignOutReason) => void;
  consumeNotice: () => void;
  /** A API recusou uma rota comum com `403 PASSWORD_CHANGE_REQUIRED`. */
  requirePasswordChange: () => void;
  /** A senha definitiva foi aceita: libera o resto da aplicação. */
  completePasswordChange: () => void;
}

/**
 * A leitura do storage acontece uma única vez, na carga do módulo: recarregar
 * a aba restaura a sessão sem nenhuma chamada de rede.
 */
export const useAuthStore = create<AuthStoreState>()((set, get) => ({
  session: readStoredSession(),
  notice: null,
  pendingPassword: null,
  signIn: (session, pendingPassword) => {
    persistSession(session);
    set({ session, notice: null, pendingPassword: pendingPassword ?? null });
  },
  signOut: (reason = 'manual') => {
    clearStoredSession();
    // Sair pelo menu também merece uma linha na tela: sem isso a pessoa volta
    // ao login sem saber se saiu mesmo ou se a sessão caiu sozinha. A senha
    // temporária do primeiro acesso morre junto — ela nunca sai da memória.
    set({
      session: null,
      pendingPassword: null,
      notice: reason === 'expired' ? LOGIN_SESSION_EXPIRED : LOGIN_SIGNED_OUT,
    });
  },
  consumeNotice: () => {
    set({ notice: null });
  },
  requirePasswordChange: () => {
    const session = get().session;
    if (session === null || session.mustChangePassword) return;
    const next: AuthSession = { ...session, mustChangePassword: true };
    persistSession(next);
    set({ session: next });
  },
  completePasswordChange: () => {
    const session = get().session;
    if (session === null) return;
    const next: AuthSession = { ...session, mustChangePassword: false };
    persistSession(next);
    set({ session: next, pendingPassword: null });
  },
}));

/** Token atual lido fora do React — é o que o cliente HTTP consulta. */
export function getSessionToken(): string | null {
  return useAuthStore.getState().session?.accessToken ?? null;
}

/** Senha temporária em memória, lida fora do React pelo hook de troca. */
export function getPendingPassword(): string | null {
  return useAuthStore.getState().pendingPassword;
}
