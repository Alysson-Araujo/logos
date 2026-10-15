import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** Faixas de pressão de SLA, alinhadas ao cálculo do backend (9.2). */
export const SLA_PRESSURE_MS = 60 * 60 * 1000;
export const SLA_DANGER_MS = 15 * 60 * 1000;
export const SLA_TOTAL_MS = 8 * 60 * 60 * 1000;

export type SlaTone = 'ok' | 'warning' | 'danger' | 'overdue' | 'done';

export function parseDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "11/02 · 12:04" — leitura rápida em tabela densa. */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (date === null) return '—';
  return format(date, "dd/MM '·' HH:mm", { locale: ptBR });
}

export function formatFullDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (date === null) return '—';
  return format(date, 'dd/MM/yyyy HH:mm:ss', { locale: ptBR });
}

export function formatTimeOnly(value: string | null | undefined): string {
  const date = parseDate(value);
  if (date === null) return '—';
  return format(date, 'HH:mm', { locale: ptBR });
}

/** "há cerca de 4 horas" — usado no detalhe. */
export function formatRelative(value: string | null | undefined): string {
  const date = parseDate(value);
  if (date === null) return '—';
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: ptBR });
}

/** "há 12min", "há 4h", "há 2d" — usado na lista, onde o espaço é curto. */
export function formatRelativeCompact(value: string | null | undefined): string {
  const date = parseDate(value);
  if (date === null) return '—';
  const diffMs = Date.now() - date.getTime();
  const isFuture = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  const label = minutes < 1 ? 'agora' : minutes < 60 ? `${String(minutes)}min` : formatHours(abs);
  if (label === 'agora') return 'agora';
  return isFuture ? `em ${label}` : `há ${label}`;
}

function formatHours(absMs: number): string {
  const totalHours = Math.floor(absMs / 3_600_000);
  if (totalHours < 24) return `${String(totalHours)}h`;
  const days = Math.floor(totalHours / 24);
  return `${String(days)}d`;
}

/** "12min", "1h 20min", "estourado há 5min". */
export function formatSlaRemaining(remainingMs: number): string {
  const abs = Math.abs(remainingMs);
  const minutes = Math.max(1, Math.round(abs / 60_000));
  const compact =
    minutes < 60
      ? `${String(minutes)}min`
      : `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}min`;
  return remainingMs < 0 ? `estourado há ${compact}` : compact;
}

export function slaTone(remainingMs: number, isClosed = false): SlaTone {
  if (isClosed) return 'done';
  if (remainingMs < 0) return 'overdue';
  if (remainingMs <= SLA_DANGER_MS) return 'danger';
  if (remainingMs <= SLA_PRESSURE_MS) return 'warning';
  return 'ok';
}

/** Percentual consumido do SLA (0–100), para a barra do detalhe. */
export function slaConsumedPercent(
  createdAt: string,
  slaDueAt: string,
  closedAt: string | null,
): number {
  const start = parseDate(createdAt);
  const due = parseDate(slaDueAt);
  if (start === null || due === null) return 0;
  const end = parseDate(closedAt)?.getTime() ?? Date.now();
  const total = due.getTime() - start.getTime();
  if (total <= 0) return 100;
  const consumed = ((end - start.getTime()) / total) * 100;
  return Math.min(Math.max(Math.round(consumed), 0), 100);
}

export function formatCoordinates(latitude: number | null, longitude: number | null): string {
  if (latitude === null || longitude === null) return '—';
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

/** Placas sempre em caixa alta e monoespaçadas. */
export function formatPlate(plate: string | null): string {
  return plate === null || plate === '' ? '—' : plate.toUpperCase();
}

export function formatVersion(version: number): string {
  return `v${String(version)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}
