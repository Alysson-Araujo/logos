/**
 * Acesso à API real, para **preparar cenário** e para conferir o que a tela
 * deixou no servidor (issue #149).
 *
 * A regra que separa este arquivo dos testes: preparação por aqui, verificação
 * pela interface. Onde o que importa é o efeito persistido — a versão que subiu,
 * o evento de auditoria que foi gravado —, a asserção também acontece aqui,
 * porque nenhuma tela mostra esse dado ainda.
 *
 * Os tipos abaixo são uma cópia deliberada do contrato de `docs/03-api.md`, e
 * não um `import` dos tipos da aplicação: um E2E que importa o tipo do produto
 * deixa de ser independente dele — se o contrato mudar, os dois lados mudam
 * juntos e o teste continua verde descrevendo o passado.
 */

export type IncidentStatus = 'ABERTO' | 'EM_INVESTIGACAO' | 'INCONCLUSIVO' | 'FECHADO';
export type IncidentCriticality = 'ALTA' | 'MEDIA' | 'BAIXA';
export type IncidentCategory =
  | 'ACIDENTE_COM_VITIMAS'
  | 'ACIDENTE_COM_VEICULO'
  | 'BLOQUEIO_DE_PISTA'
  | 'CONDICAO_CLIMATICA_ATIPICA'
  | 'PROBLEMA_MECANICO';
export type AccountRole = 'REPORTER' | 'ANALYST' | 'ADMIN';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface ApiUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
}

export interface ApiSession {
  readonly token: string;
  readonly user: ApiUser;
}

export interface IncidentDto {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: IncidentStatus;
  readonly criticality: IncidentCriticality;
  readonly category: IncidentCategory;
  readonly priorityScore: number;
  readonly version: number;
  readonly createdAt: string;
  readonly slaDueAt: string;
  readonly resolutionNotes: string | null;
  readonly assignedAnalyst: string | null;
  readonly truckPlate: string | null;
}

export interface IncidentEventDto {
  readonly id: string;
  readonly eventType: string;
  readonly fromStatus: IncidentStatus | null;
  readonly toStatus: IncidentStatus | null;
  readonly actor: string | null;
  readonly createdAt: string;
}

export interface AccountDto {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
  readonly isActive: boolean;
  readonly invitePending: boolean;
  readonly lastLoginAt: string | null;
}

export interface InvitedAccountDto {
  readonly id: string;
  readonly email: string;
  readonly role: AccountRole;
  readonly inviteExpiresAt: string;
}

export interface NewIncidentInput {
  readonly title: string;
  readonly category: IncidentCategory;
  readonly criticality: IncidentCriticality;
  readonly reportedBy: string;
  readonly description?: string;
  readonly locationLabel?: string;
  readonly truckPlate?: string;
  readonly driverName?: string;
}

interface LoginBody {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly mustChangePassword: boolean;
  readonly user: ApiUser;
}

interface IncidentListBody {
  readonly items: readonly IncidentDto[];
  readonly meta: { readonly total: number };
}

interface IncidentTimelineBody {
  readonly items: readonly IncidentEventDto[];
}

/** O par declarado em `cypress.config.ts`, com o tipo que o teste espera. */
interface E2EConfig {
  readonly apiUrl: string;
  readonly tourStorageKey: string;
}

/**
 * Configuração pública do runner.
 *
 * `Cypress.expose()` é o acesso síncrono do Cypress 16 para os valores
 * declarados em `expose` no arquivo de configuração — é o que permite montar
 * uma URL fora de um comando encadeado.
 */
export function env(): E2EConfig {
  return Cypress.expose() as E2EConfig;
}

export function apiPath(path: string): string {
  return `${env().apiUrl}${path}`;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Chave de idempotência da tentativa.
 *
 * `crypto.randomUUID` existe no navegador onde o spec roda; o prefixo diz de
 * onde a mutação veio ao olhar o banco depois de uma falha.
 */
export function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function apiLogin(credentials: Credentials): Cypress.Chainable<ApiSession> {
  return cy
    .request<LoginBody>({
      method: 'POST',
      url: apiPath('/auth/login'),
      body: { email: credentials.email, password: credentials.password },
    })
    .then((response) => ({ token: response.body.accessToken, user: response.body.user }));
}

export function apiCreateIncident(
  token: string,
  input: NewIncidentInput,
): Cypress.Chainable<IncidentDto> {
  return cy
    .request<IncidentDto>({
      method: 'POST',
      url: apiPath('/incidents'),
      headers: { ...authHeaders(token), 'Idempotency-Key': idempotencyKey('e2e-create') },
      body: input,
    })
    .then((response) => response.body);
}

/**
 * Muda o status **por fora da tela**.
 *
 * É o que permite montar o cenário do Pilar 1: a tela continua com a versão
 * antiga enquanto o servidor já avançou, que é exatamente a situação de dois
 * analistas no mesmo incidente.
 */
export function apiChangeIncidentStatus(
  token: string,
  incident: { readonly id: string; readonly version: number },
  status: IncidentStatus,
  resolutionNotes?: string,
): Cypress.Chainable<IncidentDto> {
  const body: Record<string, string> = { status };
  if (resolutionNotes !== undefined) body.resolutionNotes = resolutionNotes;

  return cy
    .request<IncidentDto>({
      method: 'POST',
      url: apiPath(`/incidents/${incident.id}/status`),
      headers: {
        ...authHeaders(token),
        'If-Match': `"${String(incident.version)}"`,
        'Idempotency-Key': idempotencyKey('e2e-status'),
      },
      body,
    })
    .then((response) => response.body);
}

/** Busca o incidente pelo código, como a barra de busca faz. */
export function apiFindIncidentByCode(token: string, code: string): Cypress.Chainable<IncidentDto> {
  return cy
    .request<IncidentListBody>({
      method: 'GET',
      url: apiPath('/incidents'),
      headers: authHeaders(token),
      qs: { search: code, limit: 1 },
    })
    .then((response) => {
      const [found] = response.body.items;
      if (found === undefined) {
        throw new Error(`Incidente ${code} não foi encontrado pela busca da API.`);
      }
      return found;
    });
}

export function apiIncidentEvents(
  token: string,
  incidentId: string,
): Cypress.Chainable<readonly IncidentEventDto[]> {
  return cy
    .request<IncidentTimelineBody>({
      method: 'GET',
      url: apiPath(`/incidents/${incidentId}/events`),
      headers: authHeaders(token),
    })
    .then((response) => response.body.items);
}

export function apiListAccounts(token: string): Cypress.Chainable<readonly AccountDto[]> {
  return cy
    .request<readonly AccountDto[]>({
      method: 'GET',
      url: apiPath('/users'),
      headers: authHeaders(token),
    })
    .then((response) => response.body);
}

export function apiInviteAccount(
  token: string,
  email: string,
  role: AccountRole,
): Cypress.Chainable<InvitedAccountDto> {
  return cy
    .request<InvitedAccountDto>({
      method: 'POST',
      url: apiPath('/users'),
      headers: authHeaders(token),
      body: { email, role },
    })
    .then((response) => response.body);
}

/** E-mail que não colide entre execuções nem entre specs. */
export function uniqueEmail(prefix: string): string {
  const sufixo = Math.floor(Math.random() * 10_000);
  return `${prefix}.${String(Date.now())}.${String(sufixo)}@example.org`;
}
