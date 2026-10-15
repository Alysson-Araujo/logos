import { describe, expect, it } from 'vitest';

import { createIncidentFixture } from '@/test/factories';

import { buildConflictDiffRows } from './ConflictDialog';

describe('buildConflictDiffRows', () => {
  it('compara campo a campo o que foi tentado e o que existe no servidor', () => {
    const server = createIncidentFixture({
      status: 'FECHADO',
      version: 4,
      resolutionNotes: 'Caso encerrado com laudo assinado pelo motorista.',
      assignedAnalyst: 'Ana Paula',
    });

    const rows = buildConflictDiffRows({
      attempted: {
        status: 'EM_INVESTIGACAO',
        resolutionNotes: null,
        viewedVersion: 3,
        attemptedAt: '2026-02-11T12:31:12Z',
      },
      server,
      message: 'O incidente foi alterado por outro analista.',
      requestId: 'req-9',
    });

    const statusRow = rows.find((row) => row.label === 'Status');
    expect(statusRow).toBeDefined();
    expect(statusRow).toMatchObject({
      attempted: 'Em Investigação',
      server: 'Fechado',
      changed: true,
    });

    const versionRow = rows.find((row) => row.label === 'Versão');
    expect(versionRow).toMatchObject({ attempted: 'v3', server: 'v4', changed: true });

    const notesRow = rows.find((row) => row.label === 'Justificativa');
    expect(notesRow).toMatchObject({
      attempted: '—',
      server: 'Caso encerrado com laudo assinado pelo motorista.',
      changed: true,
    });
  });
});
