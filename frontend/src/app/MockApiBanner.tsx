import { FlaskConical } from 'lucide-react';

import { isMockApiActive } from '@/lib/mockApiStatus';

/**
 * Faixa fixa que denuncia a API simulada.
 *
 * Com o mock no ar, **nenhum convite sai por e-mail**: a conta é criada dentro
 * do navegador e a tela confirma o envio. O sintoma que isso produziu foi
 * "clico em enviar convite e o e-mail não chega" — investigado como se fosse
 * problema de SMTP, quando a requisição nunca saiu da aba.
 *
 * Um `console.warn` não resolve o problema: quem usa a tela não abre o console.
 * A faixa fica na tela, presa ao topo, e diz o que fazer.
 *
 * Renderiza `null` quando a API real está em uso — em produção, e nos testes
 * (que usam o MSW no processo do Node, não no navegador).
 */
export function MockApiBanner() {
  if (!isMockApiActive()) return null;

  return (
    <div
      role="status"
      data-testid="mock-api-banner"
      className="flex items-center justify-center gap-2 bg-warning-soft px-3 py-1.5 text-center text-xs text-warning-text"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong>API simulada.</strong> Convites e contas não saem do navegador — nenhum e-mail é
        enviado. Defina{' '}
        <code className="rounded bg-black/10 px-1 py-0.5 font-mono">VITE_USE_MOCK=false</code> em{' '}
        <code className="rounded bg-black/10 px-1 py-0.5 font-mono">frontend/.env</code> para usar a
        API real.
      </span>
    </div>
  );
}
