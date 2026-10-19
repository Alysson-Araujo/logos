import { useMutationState } from '@tanstack/react-query';

/**
 * Quantas mutações estão **paradas esperando conexão**.
 *
 * O TanStack Query já faz o trabalho pesado: com `networkMode: 'online'`, uma
 * mutação disparada sem rede não falha — ela fica **pausada** e é retomada
 * sozinha quando o navegador volta a ficar online. O que faltava era a tela
 * dizer isso.
 *
 * **Por que isto importa mais do que parece.** O banner de offline promete
 * "suas alterações serão enviadas ao reconectar". Uma promessa que a interface
 * faz e não mostra o progresso vira dúvida: a analista não sabe se a transição
 * que ela fez entrou ou não, e o reflexo natural é fazer de novo — que é
 * exatamente como se duplica uma decisão. Mostrar o número resolve a dúvida
 * antes que ela vire retrabalho.
 *
 * O filtro é por `isPaused`, e não por `status === 'pending'`: uma mutação em
 * andamento normal também está pendente, e contá-la faria o aviso aparecer com
 * a rede funcionando.
 *
 * O `select` do TanStack mapeia **cada** mutação, devolvendo um array — por isso
 * ele projeta o identificador e a contagem é feita fora. Devolver o número
 * direto do `select` não compila, e o erro não é óbvio.
 */
export function useFilaDeMutacoes(): number {
  return useMutationState({
    filters: {
      predicate: (mutation) => mutation.state.isPaused,
    },
    select: (mutation) => mutation.mutationId,
  }).length;
}
