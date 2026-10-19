import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * A faixa que denuncia a API simulada.
 *
 * Ela existe por causa do defeito que motivou estes testes: em `pnpm dev` o
 * mock subia por padrão, criar conta respondia `201` dentro do navegador e a
 * tela dizia "Convite enviado" — sem requisição e sem e-mail. O `console.warn`
 * que já existia não era visto por quem usa a tela.
 */
describe('MockApiBanner', () => {
  it('não aparece quando a API real está em uso', async () => {
    // Módulo novo, estado novo: a flag começa desligada.
    vi.resetModules();
    const { MockApiBanner } = await import('./MockApiBanner');

    const { container } = render(<MockApiBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('mock-api-banner')).toBeNull();
  });

  it('aparece e explica que nenhum e-mail é enviado', async () => {
    vi.resetModules();
    const status = await import('@/lib/mockApiStatus');
    status.markMockApiActive();
    const { MockApiBanner } = await import('./MockApiBanner');

    render(<MockApiBanner />);

    const faixa = screen.getByTestId('mock-api-banner');
    expect(faixa).toBeInTheDocument();
    expect(faixa).toHaveTextContent(/API simulada/i);
    expect(faixa).toHaveTextContent(/nenhum e-mail é enviado/i);
    // O caminho de saída precisa estar na tela, não só no console.
    expect(faixa).toHaveTextContent('VITE_USE_MOCK=false');
  });
});
