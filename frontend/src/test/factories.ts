import type { AccountSummary } from '@/features/accounts/types';
import { computePriorityScore } from '@/features/incidents/priority';
import {
  INCIDENT_CATEGORIES,
  type Incident,
  type IncidentCategory,
  type IncidentStatus,
} from '@/features/incidents/types';

/** Gerador determinístico (mulberry32): a demo e os testes são reprodutíveis. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Instante de `days` dias atrás, na hora cheia indicada.
 *
 * Fixar a hora (em vez de "agora menos N horas") evita teste que muda de
 * resultado conforme a hora em que a suíte roda: "hoje, 09:12" continua "hoje"
 * às 9 da manhã e às 23h.
 */
function atLocalTime(days: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function daysAgo(days: number): string {
  return atLocalTime(days, 8, 0);
}

/**
 * As quatro contas usadas nos testes de tela.
 *
 * Cobrem as três situações (ativo, convite pendente, desativado) e os três
 * papéis. `Joana Prado` é a conta do frame `Admin · contas — lista`: convite
 * pendente e nenhum acesso registrado.
 */
export function createAccountFixtures(): AccountSummary[] {
  return [
    {
      id: 'conta-ana',
      name: 'Ana Paula Ribeiro',
      email: 'ana@demo.example.com',
      role: 'ADMIN',
      isActive: true,
      invitePending: false,
      lastLoginAt: atLocalTime(0, 9, 12),
      createdAt: daysAgo(90),
    },
    {
      id: 'conta-joana',
      name: 'Joana Prado',
      email: 'joana.prado@demo.example.com',
      role: 'REPORTER',
      isActive: false,
      invitePending: true,
      lastLoginAt: null,
      createdAt: daysAgo(1),
    },
    {
      id: 'conta-bruno',
      name: 'Bruno Tavares',
      email: 'bruno.tavares@demo.example.com',
      role: 'ANALYST',
      isActive: true,
      invitePending: false,
      lastLoginAt: atLocalTime(1, 17, 40),
      createdAt: daysAgo(20),
    },
    {
      id: 'conta-carla',
      name: 'Carla Mendes',
      email: 'carla.mendes@demo.example.com',
      role: 'ANALYST',
      isActive: false,
      invitePending: false,
      lastLoginAt: atLocalTime(12, 8, 0),
      createdAt: daysAgo(45),
    },
  ];
}

function pick<TOption>(random: () => number, options: readonly TOption[]): TOption {
  const index = Math.floor(random() * options.length);
  const value = options[index] ?? options[0];
  if (value === undefined) {
    throw new Error('Lista de opções vazia nas fábricas de mock.');
  }
  return value;
}

const HIGHWAYS = ['BR-116', 'BR-101', 'SP-330', 'BR-376'] as const;
const DIRECTIONS = [
  'sentido SP',
  'sentido interior',
  'sentido Curitiba',
  'sentido Porto Alegre',
] as const;

const CATEGORY_TITLES: Record<IncidentCategory, readonly string[]> = {
  ACIDENTE_COM_VITIMAS: [
    'Colisão com vítimas na faixa da esquerda',
    'Capotamento com feridos',
    'Atropelamento de pedestre na marginal',
    'Engavetamento com vítimas leves',
  ],
  ACIDENTE_COM_VEICULO: [
    'Colisão traseira sem feridos',
    'Caminhão saiu da pista e atingiu a defensa',
    'Batida lateral no trevo de acesso',
    'Veículo parado na faixa da direita após choque',
  ],
  CONDICAO_CLIMATICA_ATIPICA: [
    'Neblina densa reduz visibilidade',
    'Chuva forte com aquaplanagem',
    'Queda de granizo na pista',
    'Vendaval derrubou galhos na rodovia',
  ],
  PROBLEMA_MECANICO: [
    'Pane no sistema de freios',
    'Superaquecimento do motor',
    'Pneu estourado na traseira',
    'Falha elétrica com caminhão imobilizado',
  ],
  BLOQUEIO_DE_PISTA: [
    'Bloqueio total por queda de carga',
    'Faixa interditada para remoção de veículo',
    'Interdição por obra emergencial',
    'Bloqueio parcial por óleo na pista',
  ],
};

const CATEGORY_DESCRIPTIONS: Record<IncidentCategory, readonly string[]> = {
  ACIDENTE_COM_VITIMAS: [
    'Equipe de resgate acionada. Vítimas conscientes e orientadas.',
    'Duas vítimas leves já atendidas no local pelo SAMU.',
  ],
  ACIDENTE_COM_VEICULO: [
    'Somente danos materiais. Motorista recusa atendimento médico.',
    'Veículo precisa de guincho. Faixa liberada parcialmente.',
  ],
  CONDICAO_CLIMATICA_ATIPICA: [
    'Trecho sinalizado pela concessionária. Reduzir velocidade.',
    'Operação padrão ativada até a melhora das condições.',
  ],
  PROBLEMA_MECANICO: [
    'Motorista aguardando apoio mecânico no acostamento.',
    'Segunda unidade enviada para transbordo da carga.',
  ],
  BLOQUEIO_DE_PISTA: [
    'Carga espalhada na pista. Operação de limpeza em andamento.',
    'Faixa liberada após remoção, fluxo normalizando.',
  ],
};

const DRIVER_NAMES = [
  'João M. Ferreira',
  'Ana Paula Souza',
  'Carlos Eduardo Lima',
  'Marina Alves',
  'Roberto Nogueira',
  'Patrícia Ramos',
  'Sérgio Bastos',
  'Fernanda Ribeiro',
  'Luiz Otávio Prado',
  'Cláudia Martins',
  'Edson Tavares',
  'Rafael Andrade',
  'Juliana Castro',
  'Marcos Vinícius Reis',
  'Tatiane Correia',
] as const;

const ANALYSTS = ['Ana Paula', 'Alysson Araújo', 'Bruno Cardoso', 'Camila Duarte'] as const;
const REPORTERS = [
  'Rádio Frota 12',
  'App Motorista',
  'Câmera IA',
  'Concessionária',
  'Torre de Controle',
] as const;
const PLATE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Janela de SLA (em horas) por criticidade — mesma lógica do backend. */
const SLA_HOURS_BY_CRITICALITY = {
  ALTA: [1, 3, 4, 6, 8],
  MEDIA: [2, 5, 7, 9, 11, 13, 19],
  BAIXA: [2, 4, 6, 8, 12, 15, 21],
} as const;

const SLA_CREDIT_HOURS: Record<IncidentStatus, number> = {
  ABERTO: 0.6,
  EM_INVESTIGACAO: 0.85,
  FECHADO: 0.7,
  INCONCLUSIVO: 0.8,
};

export const MOCK_INCIDENT_COUNT = 120;
export const MOCK_SEED = 20260211;

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

function createPlate(random: () => number): string {
  const letter = (): string => PLATE_LETTERS[Math.floor(random() * PLATE_LETTERS.length)] ?? 'A';
  const digit = (): string => String(Math.floor(random() * 10));
  // Padrão Mercosul: LLLNLNN (ex.: QRD1A23).
  return `${letter()}${letter()}${letter()}${digit()}${letter()}${digit()}${digit()}`;
}

function createId(index: number): string {
  return `0f2c7a10-0000-4000-8000-${pad(index + 1, 12)}`;
}

function chooseStatus(random: () => number): IncidentStatus {
  const roll = random();
  if (roll < 0.2) return 'ABERTO';
  if (roll < 0.35) return 'EM_INVESTIGACAO';
  if (roll < 0.45) return 'INCONCLUSIVO';
  return 'FECHADO';
}

/** Um incidente válido e previsível, usado nos testes de componente. */
export function createIncidentFixture(overrides: Partial<Incident> = {}): Incident {
  const now = Date.now();
  const base: Incident = {
    id: '0f2c7a10-0000-4000-8000-000000000123',
    code: 'INC-2026-000123',
    title: 'Acidente com vítimas — BR-116 km 412',
    description: 'Colisão traseira com duas vítimas leves atendidas no local.',
    category: 'ACIDENTE_COM_VITIMAS',
    criticality: 'ALTA',
    status: 'ABERTO',
    latitude: -23.5505,
    longitude: -46.6333,
    locationLabel: 'BR-116 km 412, sentido SP',
    truckPlate: 'QRD1A23',
    driverName: 'João M. Ferreira',
    reportedBy: 'Rádio Frota 12',
    assignedAnalyst: null,
    resolutionNotes: null,
    priorityScore: 1340,
    slaDueAt: new Date(now + 12 * 60_000).toISOString(),
    version: 3,
    createdAt: new Date(now - 4 * 3_600_000).toISOString(),
    updatedAt: new Date(now - 5 * 60_000).toISOString(),
    closedAt: null,
  };

  return { ...base, ...overrides };
}

/** 120 incidentes realistas em pt-BR (rodovias, placas Mercosul, nomes brasileiros). */
export function createIncidentFixtures(
  count: number = MOCK_INCIDENT_COUNT,
  seed: number = MOCK_SEED,
): Incident[] {
  const random = createRandom(seed);
  const now = Date.now();

  return Array.from({ length: count }, (_, index) => {
    const category = pick(random, INCIDENT_CATEGORIES);
    const criticality = pick(random, ['ALTA', 'MEDIA', 'BAIXA'] as const);
    const status = chooseStatus(random);
    const highway = pick(random, HIGHWAYS);
    const direction = pick(random, DIRECTIONS);
    const kilometer = 20 + Math.floor(random() * 620);
    const locationLabel = `${highway} km ${String(kilometer)}, ${direction}`;
    const createdAt = new Date(
      now - Math.floor(random() * 96) * 3_600_000 - Math.floor(random() * 55) * 60_000,
    );
    const slaHours = pick(random, SLA_HOURS_BY_CRITICALITY[criticality]);
    const slaDueAt = new Date(createdAt.getTime() + slaHours * 3_600_000);
    const isClosed = status === 'FECHADO' || status === 'INCONCLUSIVO';
    const closingHours = Math.max(0.4, slaHours * SLA_CREDIT_HOURS[status]);
    const closedAt = isClosed ? new Date(createdAt.getTime() + closingHours * 3_600_000) : null;
    const updatedAt = closedAt ?? new Date(createdAt.getTime() + random() * 3_600_000);
    const base: Incident = {
      id: createId(index),
      code: `INC-2026-${pad(index + 1, 6)}`,
      title: `${pick(random, CATEGORY_TITLES[category])} — ${locationLabel}`,
      description: pick(random, CATEGORY_DESCRIPTIONS[category]),
      category,
      criticality,
      status,
      latitude: -23.5 + random() * 2,
      longitude: -46.6 + random() * 2,
      locationLabel,
      truckPlate: createPlate(random),
      driverName: pick(random, DRIVER_NAMES),
      reportedBy: pick(random, REPORTERS),
      assignedAnalyst: status === 'ABERTO' ? null : pick(random, ANALYSTS),
      resolutionNotes: isClosed
        ? 'Caso encerrado após apuração com o motorista e a concessionária do trecho.'
        : null,
      priorityScore: 0,
      slaDueAt: slaDueAt.toISOString(),
      version: 1 + Math.floor(random() * 5),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      closedAt: closedAt === null ? null : closedAt.toISOString(),
    };

    return { ...base, priorityScore: computePriorityScore(base) };
  });
}
