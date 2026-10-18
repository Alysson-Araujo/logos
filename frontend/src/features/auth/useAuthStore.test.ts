import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestSession } from '@/test/auth';

import { LOGIN_SESSION_EXPIRED, LOGIN_SIGNED_OUT } from './labels';
import { getSessionToken, useAuthStore } from './useAuthStore';

const STORAGE_KEY = 'logos-session';

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ session: null, notice: null });
});

describe('useAuthStore', () => {
  it('persiste a sessão na aba e a entrega ao cliente HTTP', () => {
    const session = createTestSession();

    useAuthStore.getState().signIn(session);

    expect(useAuthStore.getState().session).toEqual(session);
    expect(getSessionToken()).toBe(session.accessToken);

    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? 'null')).toMatchObject({ accessToken: session.accessToken });
  });

  it('limpa aba e token ao sair', () => {
    useAuthStore.getState().signIn(createTestSession());

    useAuthStore.getState().signOut();

    expect(useAuthStore.getState().session).toBeNull();
    expect(getSessionToken()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('avisa quando a sessão expira e também quando a pessoa sai pelo menu', () => {
    useAuthStore.getState().signOut('expired');
    expect(useAuthStore.getState().notice).toBe(LOGIN_SESSION_EXPIRED);

    useAuthStore.getState().consumeNotice();
    expect(useAuthStore.getState().notice).toBeNull();

    useAuthStore.getState().signOut('manual');
    expect(useAuthStore.getState().notice).toBe(LOGIN_SIGNED_OUT);
  });

  it('limpa o aviso pendente quando alguém entra', () => {
    useAuthStore.getState().signOut('expired');

    useAuthStore.getState().signIn(createTestSession());

    expect(useAuthStore.getState().notice).toBeNull();
  });

  /* A leitura da aba acontece na carga do módulo: só um recarregamento
     de módulos reproduz o que o navegador faz ao abrir a página. */
  describe('reconstrução a partir da aba', () => {
    async function loadStoreFresh() {
      vi.resetModules();
      return await import('./useAuthStore');
    }

    it('restaura a sessão válida', async () => {
      const session = createTestSession();
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));

      const { useAuthStore: restored } = await loadStoreFresh();

      expect(restored.getState().session?.accessToken).toBe(session.accessToken);
      expect(restored.getState().session?.user.name).toBe('Ana Paula Ribeiro');
    });

    it('descarta token vencido e limpa a aba', async () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(createTestSession({ expiresAt: Date.now() - 1_000 })),
      );

      const { useAuthStore: restored } = await loadStoreFresh();

      expect(restored.getState().session).toBeNull();
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('descarta conteúdo que não corresponde ao contrato', async () => {
      window.sessionStorage.setItem(STORAGE_KEY, '{"accessToken":"curto"}');

      const { useAuthStore: restored } = await loadStoreFresh();

      expect(restored.getState().session).toBeNull();
    });

    it('sobrevive a JSON inválido sem quebrar a aplicação', async () => {
      window.sessionStorage.setItem(STORAGE_KEY, '{nao-e-json');

      const { useAuthStore: restored } = await loadStoreFresh();

      expect(restored.getState().session).toBeNull();
    });
  });
});
