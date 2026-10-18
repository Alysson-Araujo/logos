import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ACCOUNT_ROLE_FILTER_OPTIONS, parseRoleFilter } from '../labels';
import type { AccountRoleFilter } from '../types';

export interface AccountsToolbarProps {
  search: string;
  roleFilter: AccountRoleFilter;
  /** "4 contas · 2 convites pendentes". */
  summary: string;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: AccountRoleFilter) => void;
}

export const SEARCH_PLACEHOLDER = 'Buscar por nome ou e-mail';

/**
 * Barra de filtros da lista (frame `Admin · contas — lista`).
 *
 * A busca é local: `GET /users` não tem parâmetro de filtro, então filtrar aqui
 * evita uma requisição por tecla e mantém a tela instantânea.
 */
export function AccountsToolbar({
  search,
  roleFilter,
  summary,
  onSearchChange,
  onRoleFilterChange,
}: AccountsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-[420px] max-w-full">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label={SEARCH_PLACEHOLDER}
          placeholder={SEARCH_PLACEHOLDER}
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          className="pl-9"
        />
      </div>

      <Select
        value={roleFilter}
        onValueChange={(value: string) => {
          onRoleFilterChange(parseRoleFilter(value));
        }}
      >
        <SelectTrigger className="w-[200px]" aria-label="Filtrar por papel">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACCOUNT_ROLE_FILTER_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className="ml-auto text-2xs text-fg-muted" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}
