import { httpClient } from '@/lib/http';

import {
  accountListSchema,
  accountSummarySchema,
  invitedAccountSchema,
  parseContract,
} from './schemas';
import type { AccountSummary, CreateAccountInput, InvitedAccount } from './types';

const USERS_PATH = '/users';

/** `GET /users` — exige `ADMIN`; a lista vem das mais recentes para as antigas. */
export async function fetchAccounts(signal?: AbortSignal): Promise<AccountSummary[]> {
  const raw = await httpClient.get(USERS_PATH, { signal });
  return parseContract(accountListSchema, raw);
}

/**
 * `POST /users` — 201 com `{ id, email, role, inviteExpiresAt }`.
 *
 * O corpo leva **só** e-mail e papel: o nome é derivado do e-mail pelo
 * servidor e a senha temporária nunca passa por aqui — ela sai por e-mail.
 */
export async function createAccount(
  input: CreateAccountInput,
  signal?: AbortSignal,
): Promise<InvitedAccount> {
  const raw = await httpClient.post(USERS_PATH, input, { signal });
  return parseContract(invitedAccountSchema, raw);
}

/** `POST /users/{id}/invite` — 204; invalida a senha temporária anterior. */
export async function resendInvite(id: string, signal?: AbortSignal): Promise<void> {
  await httpClient.post(`${USERS_PATH}/${encodeURIComponent(id)}/invite`, undefined, { signal });
}

/** `PATCH /users/{id}` — `isActive` é obrigatório no corpo. */
export async function setAccountActive(
  id: string,
  isActive: boolean,
  signal?: AbortSignal,
): Promise<AccountSummary> {
  const raw = await httpClient.patch(
    `${USERS_PATH}/${encodeURIComponent(id)}`,
    { isActive },
    { signal },
  );
  return parseContract(accountSummarySchema, raw);
}
