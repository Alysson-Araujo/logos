/**
 * Rodapé da aplicação: créditos, a coluna de atalhos e o link do repositório.
 *
 * O bloco de atalhos é o alvo do passo "Atalhos do teclado" do guia de
 * boas-vindas — daí o `data-tour="shortcuts"`. Ele saiu de dentro do `AppShell`
 * para ter nome próprio: o guia procura alvos por `data-tour`, e um `<span>`
 * anônimo no meio do shell não dizia a ninguém onde ficava o rodapé.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-subtle">
        <span>Logos · case fullstack AutoU · dados de demonstração</span>
        <span data-tour="shortcuts" className="font-mono">
          j/k navega · Enter abre · / busca · t tema · Esc fecha
        </span>
        <a
          className="ml-auto underline-offset-4 hover:text-fg hover:underline"
          href="https://github.com/Alysson-Araujo/logos"
          target="_blank"
          rel="noreferrer noopener"
        >
          Repositório
        </a>
      </div>
    </footer>
  );
}
