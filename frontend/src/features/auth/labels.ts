import { isApiError } from '@/lib/http';

import type { AuthRole, AuthUser } from './types';

/** Rótulo do papel no vocabulário da interface (o Figma usa minúsculas). */
export const AUTH_ROLE_LABELS: Record<AuthRole, string> = {
  REPORTER: 'repórter',
  ANALYST: 'analista',
  ADMIN: 'administrador',
};

export function roleLabel(role: AuthRole): string {
  return AUTH_ROLE_LABELS[role];
}

/** "Ana Paula Ribeiro" → "AP" (mesmo formato do avatar do header). */
export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const initials = `${first}${last}`.toUpperCase();
  return initials === '' ? '?' : initials;
}

/** "Ana Paula Ribeiro · analista" — o que o header mostra. */
export function formatSessionLabel(user: AuthUser): string {
  return `${user.name} · ${roleLabel(user.role)}`;
}

/* ------------------------------------------------------------------ */
/* Copy de erro do login                                               */
/* ------------------------------------------------------------------ */

/** Texto exato do frame `Login · erro de credencial`. */
export const LOGIN_INVALID_CREDENTIALS = 'Credenciais inválidas. Verifique e-mail e senha.';

/** Sessão derrubada pelo servidor: a pessoa precisa saber por que voltou aqui. */
export const LOGIN_SESSION_EXPIRED = 'Sua sessão expirou. Entre novamente.';

/** Saída pelo menu do usuário — o frame desenha este aviso em tom de informação. */
export const LOGIN_SIGNED_OUT = 'Sessão encerrada. Entre novamente para continuar.';

/* ------------------------------------------------------------------ */
/* Copy da troca de senha                                              */
/* ------------------------------------------------------------------ */

/** A política real da API: só comprimento. Ver `app/domain/accounts.py`. */
export const PASSWORD_POLICY_HINT = 'Mínimo de 12 caracteres.';

/** Confirmação da troca — o frame `Primeiro acesso` usa a mesma frase. */
export const PASSWORD_CHANGED = 'Senha alterada. Use a nova no próximo acesso.';

const PASSWORD_CURRENT_WRONG = 'A senha atual está incorreta.';
const PASSWORD_REJECTED = 'A nova senha não atende à política.';
const PASSWORD_UNKNOWN = 'Não foi possível trocar a senha. Tente de novo.';

/**
 * Traduz a falha da troca de senha. Vale a mesma regra do login: quem escreve a
 * mensagem é o código, não o servidor.
 */
export function describeChangePasswordError(error: unknown): string {
  if (!isApiError(error)) return PASSWORD_UNKNOWN;

  if (error.code === 'INVALID_CREDENTIALS' || error.status === 401) return PASSWORD_CURRENT_WRONG;
  if (error.status === 422) return PASSWORD_REJECTED;
  if (error.status === 429) return LOGIN_RATE_LIMITED;
  if (error.status >= 500) return PASSWORD_UNKNOWN;
  if (error.kind === 'timeout' || error.kind === 'offline' || error.kind === 'network') {
    return PASSWORD_UNKNOWN;
  }

  return PASSWORD_UNKNOWN;
}

const LOGIN_TIMEOUT = 'A API demorou para responder. Ela pode estar acordando — tente de novo.';
const LOGIN_UNREACHABLE = 'Sem conexão com a API. Verifique sua rede e tente de novo.';
const LOGIN_RATE_LIMITED = 'Muitas tentativas. Aguarde alguns instantes.';
const LOGIN_SERVER_ERROR = 'A API falhou ao processar o login. Tente de novo.';
const LOGIN_UNKNOWN = 'Não foi possível entrar. Tente de novo.';

/**
 * Traduz a falha para a copy da interface.
 *
 * A mensagem do servidor **não** é exibida: o texto que aparece é o do Figma,
 * decidido por código. Assim a API deixa de ditar UI e nenhuma mensagem
 * interna vaza para a tela.
 */
export function describeLoginError(error: unknown): string {
  if (!isApiError(error)) return LOGIN_UNKNOWN;

  if (error.code === 'INVALID_CREDENTIALS') return LOGIN_INVALID_CREDENTIALS;
  if (error.code === 'UNAUTHENTICATED' || error.code === 'TOKEN_EXPIRED') {
    return LOGIN_SESSION_EXPIRED;
  }

  if (error.kind === 'timeout') return LOGIN_TIMEOUT;
  if (error.kind === 'offline' || error.kind === 'network') return LOGIN_UNREACHABLE;
  if (error.kind === 'contract') return LOGIN_SERVER_ERROR;
  if (error.status === 429) return LOGIN_RATE_LIMITED;
  if (error.status >= 500) return LOGIN_SERVER_ERROR;

  return LOGIN_UNKNOWN;
}

/* ------------------------------------------------------------------ */
/* Copy da troca de senha (primeiro acesso)                            */
/* ------------------------------------------------------------------ */

/** Texto exato do frame `Primeiro acesso · definir senha`. */
export const CHANGE_PASSWORD_SUBTITLE = 'Defina a senha definitiva para continuar.';
export const CHANGE_PASSWORD_HINT = 'A temporária deixa de valer ao salvar.';
export const CHANGE_PASSWORD_POLICY_TITLE = 'POLÍTICA DE SENHA';
export const CHANGE_PASSWORD_POLICY_TEXT = 'Mínimo de 12 caracteres.';

/**
 * A senha temporária só vive em memória: quem recarregou a aba no meio do
 * primeiro acesso precisa entrar de novo. Melhor dizer isso do que oferecer um
 * formulário que a API recusaria por falta da senha atual.
 */
export const CHANGE_PASSWORD_MISSING_TEMPORARY =
  'A senha temporária não está mais nesta aba. Saia e entre novamente para definir a senha definitiva.';

const CHANGE_PASSWORD_WRONG_CURRENT =
  'A senha temporária não confere ou já expirou. Saia e entre novamente.';
const CHANGE_PASSWORD_UNREACHABLE = 'Sem conexão com a API. Verifique sua rede e tente de novo.';
const CHANGE_PASSWORD_SERVER_ERROR = 'A API não conseguiu salvar a nova senha. Tente de novo.';
const CHANGE_PASSWORD_UNKNOWN = 'Não foi possível salvar a nova senha. Tente de novo.';

function readMinLength(details: unknown): number | null {
  if (typeof details !== 'object' || details === null) return null;
  const value = (details as Record<string, unknown>).minLength;
  return typeof value === 'number' ? value : null;
}

/** Traduz a falha da troca de senha para a copy da interface. */
export function describePasswordChangeError(error: unknown): string {
  if (!isApiError(error)) return CHANGE_PASSWORD_UNKNOWN;

  if (error.status === 401 || error.code === 'INVALID_CREDENTIALS') {
    return CHANGE_PASSWORD_WRONG_CURRENT;
  }
  if (error.code === 'WEAK_PASSWORD') {
    const minLength = readMinLength(error.details);
    return minLength === null
      ? CHANGE_PASSWORD_POLICY_TEXT
      : `A senha deve ter ao menos ${String(minLength)} caracteres.`;
  }
  if (error.kind === 'timeout' || error.kind === 'offline' || error.kind === 'network') {
    return CHANGE_PASSWORD_UNREACHABLE;
  }
  if (error.status === 422) return 'A senha não atende à política mínima.';
  if (error.status >= 500 || error.kind === 'contract') return CHANGE_PASSWORD_SERVER_ERROR;

  return CHANGE_PASSWORD_UNKNOWN;
}
