import { differenceInCalendarDays, format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { parseDate } from '@/lib/formatters';
import { isApiError, PASSWORD_CHANGE_REQUIRED_CODE } from '@/lib/http';

import { readValidationIssue, type AccountFieldIssue } from './schemas';
import {
  ALL_ROLES,
  type AccountRole,
  type AccountRoleFilter,
  type AccountSituation,
  type AccountSummary,
} from './types';

/* ------------------------------------------------------------------ */
/* Papéis                                                              */
/* ------------------------------------------------------------------ */

/** O rótulo do papel é o próprio valor do contrato (badge em caixa alta). */
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = {
  REPORTER: 'REPORTER',
  ANALYST: 'ANALYST',
  ADMIN: 'ADMIN',
};

/** O que cada papel faz, na copy do frame `Admin · contas — nova conta`. */
export const ACCOUNT_ROLE_DESCRIPTIONS: Record<AccountRole, string> = {
  REPORTER: 'registra incidentes',
  ANALYST: 'conduz o ciclo e resolve',
  ADMIN: 'administra contas',
};

/** `REPORTER · registra incidentes` — usado no Select de papel. */
export function roleOptionLabel(role: AccountRole): string {
  return `${ACCOUNT_ROLE_LABELS[role]} · ${ACCOUNT_ROLE_DESCRIPTIONS[role]}`;
}

export const ACCOUNT_ROLE_OPTIONS: readonly AccountRole[] = ['REPORTER', 'ANALYST', 'ADMIN'];

export const ALL_ROLES_LABEL = 'Todos os papéis';

export const ACCOUNT_ROLE_FILTER_OPTIONS: readonly { value: AccountRoleFilter; label: string }[] = [
  { value: ALL_ROLES, label: ALL_ROLES_LABEL },
  ...ACCOUNT_ROLE_OPTIONS.map((role) => ({ value: role, label: ACCOUNT_ROLE_LABELS[role] })),
];

/** Valor vindo do Select, sem `as`: fora da lista cai em "Todos os papéis". */
export function parseRoleFilter(value: string): AccountRoleFilter {
  return ACCOUNT_ROLE_FILTER_OPTIONS.find((option) => option.value === value)?.value ?? ALL_ROLES;
}

/** Texto de ajuda abaixo do Select de papel. */
export const ROLE_HELP_TEXT =
  'REPORTER registra · ANALYST conduz o ciclo e resolve · ADMIN administra contas';

/* ------------------------------------------------------------------ */
/* Situação                                                            */
/* ------------------------------------------------------------------ */

export const ACCOUNT_SITUATION_LABELS: Record<AccountSituation, string> = {
  active: 'Ativo',
  pending: 'Convite pendente',
  inactive: 'Desativado',
};

export type AccountSituationTone = 'success' | 'warning' | 'danger';

export const ACCOUNT_SITUATION_TONES: Record<AccountSituation, AccountSituationTone> = {
  active: 'success',
  pending: 'warning',
  inactive: 'danger',
};

/** Convite pendente vence "desativado": é o estado que pede ação. */
export function accountSituation(account: AccountSummary): AccountSituation {
  if (account.invitePending) return 'pending';
  return account.isActive ? 'active' : 'inactive';
}

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

/**
 * "hoje, 09:12" · "ontem, 17:40" · "12 dias atrás" · "—".
 *
 * A coluna é estreita e a pergunta que ela responde é "quando essa pessoa
 * entrou pela última vez?", não "em que data exata". A data absoluta continua
 * disponível no `title` da célula.
 */
export function formatLastLogin(value: string | null, reference: Date = new Date()): string {
  const date = parseDate(value);
  if (date === null) return '—';
  if (isToday(date)) return `hoje, ${format(date, 'HH:mm', { locale: ptBR })}`;
  if (isYesterday(date)) return `ontem, ${format(date, 'HH:mm', { locale: ptBR })}`;

  const days = differenceInCalendarDays(reference, date);
  // Relógio adiantado (ou fuso): uma data no futuro não é "há -2 dias".
  if (days < 0) return format(date, 'dd/MM/yyyy', { locale: ptBR });
  return `${String(days)} dias atrás`;
}

/** Data absoluta para o `title` da célula de último acesso. */
export function formatLastLoginAbsolute(value: string | null): string {
  const date = parseDate(value);
  if (date === null) return 'Nunca acessou';
  return format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/* ------------------------------------------------------------------ */
/* Resumo da barra                                                     */
/* ------------------------------------------------------------------ */

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

/** "4 contas · 2 convites pendentes" (singular e plural corretos). */
export function formatAccountsSummary(total: number, pending: number): string {
  const accounts = plural(total, 'conta', 'contas');
  const invites = plural(pending, 'convite pendente', 'convites pendentes');
  return `${accounts} · ${invites}`;
}

/* ------------------------------------------------------------------ */
/* Erros                                                               */
/* ------------------------------------------------------------------ */

const ACCOUNTS_UNREACHABLE = 'Sem conexão com a API. Verifique sua rede e tente de novo.';
const ACCOUNTS_TIMEOUT = 'A API demorou para responder. Tente de novo.';
const ACCOUNTS_SERVER_ERROR = 'A API falhou ao concluir a operação. Tente de novo.';
const ACCOUNTS_RATE_LIMITED = 'Muitas tentativas. Aguarde alguns instantes.';
const ACCOUNTS_UNKNOWN = 'Não foi possível concluir a operação. Tente de novo.';

export const EMAIL_ALREADY_EXISTS_MESSAGE = 'Já existe uma conta com este e-mail.';
export const INSUFFICIENT_ROLE_MESSAGE =
  'Seu perfil não tem permissão para administrar contas de acesso.';

/** Códigos da API que a tela trata de forma diferente da mensagem genérica. */
const USER_NOT_FOUND_CODE = 'USER_NOT_FOUND';
const EMAIL_ALREADY_EXISTS_CODE = 'EMAIL_ALREADY_EXISTS';

/**
 * A conta foi criada e o e-mail do convite não saiu.
 *
 * Copiada da API de propósito: a mesma frase aparece na resposta e na tela, e
 * ter uma só fonte evita as duas divergirem. A diferença é que aqui ela vem
 * acompanhada do caminho de recuperação — "Reenviar convite".
 */
export const INVITE_DELIVERY_FAILED_CODE = 'INVITE_DELIVERY_FAILED';
export const INVITE_DELIVERY_FAILED_MESSAGE =
  'A conta foi criada, mas o e-mail do convite não saiu. Use "Reenviar convite" na linha da conta para tentar de novo.';

/**
 * O `409` que **não** é e-mail repetido.
 *
 * Sem esta distinção a tela dizia "Já existe uma conta com este e-mail" — o que
 * é falso (a conta é a que acabou de ser criada) e aponta para o campo errado:
 * trocar o endereço não resolve um problema de envio.
 */
export function isInviteDeliveryFailure(error: unknown): boolean {
  return isApiError(error) && error.code === INVITE_DELIVERY_FAILED_CODE;
}

/** `403` de papel — não confundir com o `403` de senha temporária, que troca a tela. */
export function isPermissionError(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && error.code !== PASSWORD_CHANGE_REQUIRED_CODE;
}

export function describeAccountsError(error: unknown): string {
  if (!isApiError(error)) return ACCOUNTS_UNKNOWN;
  if (error.kind === 'timeout') return ACCOUNTS_TIMEOUT;
  if (error.kind === 'offline' || error.kind === 'network') return ACCOUNTS_UNREACHABLE;
  if (error.kind === 'contract') return ACCOUNTS_SERVER_ERROR;
  if (error.status === 429) return ACCOUNTS_RATE_LIMITED;
  if (error.status >= 500) return ACCOUNTS_SERVER_ERROR;
  if (error.code === 'CANNOT_DEACTIVATE_SELF') {
    return 'Você não pode desativar a própria conta.';
  }
  if (error.code === USER_NOT_FOUND_CODE) return 'A conta não existe mais. Recarregue a lista.';
  if (isInviteDeliveryFailure(error)) return INVITE_DELIVERY_FAILED_MESSAGE;
  // 4xx de domínio já vêm em pt-BR da API ("Você não pode…", "Já existe…").
  return error.message;
}

/** Traduz a falha de criação para o campo certo do formulário. */
export function describeCreateAccountError(error: unknown): AccountFieldIssue {
  if (!isApiError(error)) return { field: null, message: ACCOUNTS_UNKNOWN };

  // A conta **foi** criada e só o e-mail não saiu. Não é erro de e-mail
  // repetido: apontar o campo de e-mail aqui mandaria a pessoa trocar o
  // endereço, e o problema está no envio. Fica como mensagem do formulário.
  if (isInviteDeliveryFailure(error)) {
    return { field: null, message: INVITE_DELIVERY_FAILED_MESSAGE };
  }

  // 409 é e-mail repetido no contrato; o código da API é mais específico.
  if (error.status === 409 || error.code === EMAIL_ALREADY_EXISTS_CODE) {
    return { field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE };
  }
  if (error.status === 422) {
    const issue = readValidationIssue(error.details);
    if (issue !== null) return issue;
    return { field: null, message: 'Revise os dados enviados.' };
  }
  if (isPermissionError(error)) return { field: null, message: INSUFFICIENT_ROLE_MESSAGE };

  return { field: null, message: describeAccountsError(error) };
}
