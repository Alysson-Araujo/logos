import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/http';
import { createIncidentFixture } from '@/test/factories';

import { createIncident } from '../api/endpoints';
import { CreateIncidentSheet } from './CreateIncidentSheet';

/**
 * A camada HTTP é mockada de propósito: este arquivo testa a **tela**, e o
 * contrato do `POST /incidents` é verificado com a API simulada em
 * `../api/endpoints.test.ts` (ambiente `node`, onde o MSW intercepta o `fetch`
 * do undici — em jsdom o interceptor recusa o `AbortSignal` do outro realm).
 * `readIncidentFieldErrors` continua real: é ele que posiciona o erro de campo.
 */
vi.mock('../api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createIncident: vi.fn() };
});

const createIncidentMock = vi.mocked(createIncident);

/**
 * O jsdom não implementa Pointer Capture nem `scrollIntoView`, usados pelo
 * Radix Select ao abrir a lista de opções.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

/** Reproduz o encaixe real: um botão da triagem que abre a sheet. */
function CreateIncidentHarness() {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <button type="button" onClick={handleOpen}>
        Novo incidente
      </button>
      <CreateIncidentSheet open={open} onClose={handleClose} />
    </>
  );
}

function renderSheet(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <CreateIncidentHarness />
    </QueryClientProvider>,
  );
}

async function openSheet(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Novo incidente' }));
  await screen.findByRole('dialog');
}

/** Escolhe uma opção do Radix Select pelo rótulo do campo. */
async function chooseOption(user: UserEvent, label: RegExp, option: string): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Preenche só os obrigatórios; os opcionais ficam de fora de propósito. */
async function fillRequiredFields(user: UserEvent): Promise<void> {
  await user.type(screen.getByLabelText(/^Título do incidente/), 'Colisão na pista');
  await chooseOption(user, /^Categoria/, 'Acidente com Veículo');
  await chooseOption(user, /^Criticidade/, 'Alta');
  await user.type(screen.getByLabelText(/^Reportado por/), 'Rádio Frota 12');
}

function validationError(details: unknown): ApiError {
  return new ApiError({
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'A requisição contém dados inválidos.',
    details,
  });
}

function describedText(element: HTMLElement): string {
  const id = element.getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? '';
}

describe('CreateIncidentSheet', () => {
  it('mostra o resumo e os erros por campo sem chamar a API', async () => {
    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '4 campos precisam de atenção antes de criar o incidente.',
    );
    expect(screen.getByText('Informe o título com pelo menos 3 caracteres.')).toBeInTheDocument();
    expect(screen.getByText('Selecione a categoria.')).toBeInTheDocument();
    expect(screen.getByText('Selecione a criticidade.')).toBeInTheDocument();
    expect(
      screen.getByText('Informe o canal de origem — de 2 a 80 caracteres.'),
    ).toBeInTheDocument();

    const title = screen.getByLabelText(/^Título do incidente/);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(title)).toBe('Informe o título com pelo menos 3 caracteres.');
    expect(title).toHaveFocus();

    expect(createIncidentMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('envia os obrigatórios com o payload camelCase e fecha a sheet', async () => {
    createIncidentMock.mockResolvedValue(createIncidentFixture());

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    expect(screen.getByText(/SLA a partir da criação/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    await waitFor(() => {
      expect(createIncidentMock).toHaveBeenCalledTimes(1);
    });
    expect(createIncidentMock.mock.calls[0]?.[0].input).toEqual({
      title: 'Colisão na pista',
      category: 'ACIDENTE_COM_VEICULO',
      criticality: 'ALTA',
      reportedBy: 'Rádio Frota 12',
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('mostra "Criando…" e desabilita os campos durante o envio', async () => {
    let release: (incident: ReturnType<typeof createIncidentFixture>) => void = () => undefined;
    createIncidentMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    expect(await screen.findByRole('button', { name: /Criando/ })).toBeDisabled();
    expect(screen.getByLabelText(/^Título do incidente/)).toBeDisabled();
    expect(screen.getByLabelText(/^Placa do veículo/)).toBeDisabled();

    await act(async () => {
      release(createIncidentFixture());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('devolve o erro de campo do 422 no formato do FastAPI ao campo certo', async () => {
    // O cliente aceitou a placa e o servidor recusou: a validação do servidor
    // é a autoridade, e é a mensagem dele que aparece sob o campo.
    createIncidentMock.mockRejectedValue(
      validationError({
        validationErrors: [
          {
            type: 'value_error',
            loc: ['body', 'truckPlate'],
            msg: 'truckPlate inválida: use o padrão Mercosul (AAA1A23) ou antigo (AAA1234).',
            input: 'AAA1A2',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);
    await user.type(screen.getByLabelText(/^Placa do veículo/), 'AAA1A23');

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '1 campo precisa de atenção antes de criar o incidente.',
    );

    const plate = screen.getByLabelText(/^Placa do veículo/);
    expect(plate).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(plate)).toBe(
      'truckPlate inválida: use o padrão Mercosul (AAA1A23) ou antigo (AAA1234).',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('devolve o erro de campo do 422 no formato do mock (issues) ao campo certo', async () => {
    createIncidentMock.mockRejectedValue(
      validationError({
        issues: [
          {
            code: 'too_small',
            path: ['title'],
            message: 'Informe o título com pelo menos 3 caracteres.',
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    const title = await screen.findByLabelText(/^Título do incidente/);
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(describedText(title)).toBe('Informe o título com pelo menos 3 caracteres.');
    expect(screen.getByLabelText(/^Placa do veículo/)).toHaveAttribute('aria-invalid', 'false');
  });

  it('mostra a falha de transporte como aviso geral, sem marcar campo', async () => {
    createIncidentMock.mockRejectedValue(
      new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Falha de rede ao falar com a API.',
        kind: 'network',
      }),
    );

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede ao falar com a API.');
    expect(screen.getByLabelText(/^Título do incidente/)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('normaliza a placa digitada em minúscula com hífen', async () => {
    createIncidentMock.mockResolvedValue(createIncidentFixture());

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    const plate = screen.getByLabelText(/^Placa do veículo/);
    await user.type(plate, 'qrd-1a23');

    // Caixa alta já na digitação; espaço e hífen saem na normalização do envio.
    expect(plate).toHaveValue('QRD-1A23');

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));

    await waitFor(() => {
      expect(createIncidentMock).toHaveBeenCalledTimes(1);
    });
    expect(createIncidentMock.mock.calls[0]?.[0].input).toEqual({
      title: 'Colisão na pista',
      category: 'ACIDENTE_COM_VEICULO',
      criticality: 'ALTA',
      reportedBy: 'Rádio Frota 12',
      truckPlate: 'QRD1A23',
    });
  });

  it('envia com Ctrl + Enter', async () => {
    createIncidentMock.mockResolvedValue(createIncidentFixture());

    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    await fillRequiredFields(user);

    await user.click(screen.getByLabelText(/^Título do incidente/));
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(createIncidentMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('fecha com Esc e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    renderSheet();

    const trigger = screen.getByRole('button', { name: 'Novo incidente' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});
