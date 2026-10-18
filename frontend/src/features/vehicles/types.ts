/** Tipos do contrato de frota. */

/** Um caminhão da frota, como o autocomplete o apresenta. */
export interface Vehicle {
  id: string;
  plate: string;
  model: string;
  carrier: string;
}

/** Resposta de `GET /vehicles`: a página de sugestões e o tamanho da frota. */
export interface VehicleSearchResult {
  items: Vehicle[];
  /** Total de veículos da frota — não o da página. */
  total: number;
}
