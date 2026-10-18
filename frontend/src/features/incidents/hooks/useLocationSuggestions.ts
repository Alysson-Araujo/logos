import { useQuery } from '@tanstack/react-query';

import { useDebounce } from '@/hooks/useDebounce';

import { fetchIncidentList } from '../api/endpoints';
import { DEFAULT_INCIDENT_FILTERS, type Incident } from '../types';

/** A partir de quantos caracteres vale a pena consultar. */
export const LOCATION_MIN_CHARS = 2;

/** Sugestões por consulta. Cinco cabem na tela sem rolar. */
export const LOCATION_SUGGESTION_LIMIT = 5;

/**
 * Quanto tempo uma consulta fica fresca.
 *
 * Um minuto, e não os 30 s do resto da aplicação: a lista de locais só muda
 * quando alguém registra um incidente num lugar novo. Generoso aqui é o que
 * impede a mesma consulta de sair duas vezes quando a pessoa apaga e digita a
 * mesma letra de novo.
 */
export const LOCATION_STALE_TIME_MS = 60_000;

/**
 * Chaves de cache das sugestões, indexadas pelo termo normalizado.
 *
 * Namespace próprio (`incident-locations`) e não o da listagem: compartilhar a
 * chave com `incidentQueryKeys.list` faria a busca do formulário e a lista da
 * triagem disputarem a mesma entrada, cada uma sobrescrevendo a outra.
 */
export const locationQueryKeys = {
  all: ['incident-locations'] as const,
  search: (term: string) => [...locationQueryKeys.all, term] as const,
};

/** Extrai os locais distintos dos incidentes, na ordem em que vieram. */
function collectLocationLabels(incidents: readonly Incident[]): string[] {
  const vistos = new Set<string>();
  const labels: string[] = [];

  for (const incident of incidents) {
    const label = incident.locationLabel?.trim();
    // Vazio e repetido saem: a lista é de sugestões, e duas entradas iguais
    // fazem a pessoa duvidar de qual escolher.
    if (label === undefined || label === '' || vistos.has(label)) continue;
    vistos.add(label);
    labels.push(label);
  }

  return labels;
}

/**
 * Sugere locais já usados em incidentes anteriores.
 *
 * **A proteção contra resposta fora de ordem é a chave de cache, não um
 * `AbortController`.** Cada termo tem a sua própria entrada, e o componente lê
 * apenas a do termo atual: quando a resposta atrasada de `BR-1` chega depois da
 * de `BR-11`, ela grava na entrada de `BR-1` — que ninguém está lendo. Um
 * `AbortController` sozinho deixaria a corrida em aberto no intervalo entre o
 * abort e o `fetch` chegar ao servidor; a chave fecha a porta.
 *
 * O `signal` continua sendo repassado, porque ele resolve o outro caso: a
 * requisição em voo é abortada quando o formulário fecha ou o componente sai de
 * tela, e o `http.ts` trata aborto como `kind: 'aborted'` em vez de erro.
 *
 * **Cota.** O backend limita 60 leituras por minuto por cliente, e autocomplete
 * é o padrão que mais dispara. Três coisas seguram o consumo: o debounce de
 * 300 ms, o mínimo de dois caracteres e o `staleTime` de um minuto — este último
 * é o que faz repetir o mesmo texto não custar requisição nenhuma.
 */
export function useLocationSuggestions(term: string, enabled: boolean): string[] {
  const debouncedTerm = useDebounce(term);
  const normalizedTerm = debouncedTerm.trim().toLowerCase();

  const query = useQuery({
    queryKey: locationQueryKeys.search(normalizedTerm),
    queryFn: ({ signal }) =>
      fetchIncidentList({
        filters: { ...DEFAULT_INCIDENT_FILTERS, search: debouncedTerm.trim() },
        cursor: null,
        limit: LOCATION_SUGGESTION_LIMIT,
        signal,
      }),
    // Só consulta com dois caracteres ou mais. Com um só, a busca traria quase a
    // base inteira — sugestão que não sugere nada.
    enabled: enabled && normalizedTerm.length >= LOCATION_MIN_CHARS,
    staleTime: LOCATION_STALE_TIME_MS,
    select: (data) => collectLocationLabels(data.items),
  });

  return query.data ?? [];
}
