/**
 * Marca se a API simulada está no ar.
 *
 * Vive num módulo próprio, sem importar nada do MSW, de propósito: quem lê a
 * flag é a interface, e ela não pode arrastar o mock para o bundle de produção.
 * O `main.tsx` só carrega `test/msw/browser` por `import()` dinâmico; se a faixa
 * importasse aquele módulo diretamente, o pacote do MSW entraria no chunk
 * principal e seria baixado por quem usa a aplicação real.
 */
let mockApiActive = false;

/** Chamado pelo bootstrap do mock, uma vez, quando o worker sobe. */
export function markMockApiActive(): void {
  mockApiActive = true;
}

/** Indica se as requisições estão sendo respondidas pelo mock. */
export function isMockApiActive(): boolean {
  return mockApiActive;
}
