import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ZodError } from 'zod';

import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Drawer,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useVehicleSearch } from '@/features/vehicles/hooks/useVehicleSearch';
import type { Vehicle } from '@/features/vehicles/types';
import { isApiError } from '@/lib/http';
import { cn } from '@/lib/utils';

import { readIncidentFieldErrors } from '../api/endpoints';
import { useCreateIncident } from '../hooks/useCreateIncident';
import { useLocationSuggestions } from '../hooks/useLocationSuggestions';
import { CATEGORY_LABELS, CRITICALITY_LABELS } from '../labels';
import { CREATE_INCIDENT_FIELDS, incidentCreateSchema, type CreateIncidentField } from '../schemas';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CRITICALITIES,
  type IncidentCategory,
  type IncidentCriticality,
} from '../types';

export interface CreateIncidentSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * `false` deixa a janela **não-modal**.
   *
   * O guia de boas-vindas abre esta janela no passo 4 e mantém o próprio cartão
   * por cima. Um `Dialog` modal do Radix trava o foco e aplica
   * `pointer-events: none` no `body` — o cartão do guia fica fora do diálogo e
   * portanto **morto**: não dá para clicar em "Próximo", "Anterior" nem
   * "Pular". Sem modalidade, esses cliques voltam a funcionar e o clique fora
   * continua fechando a janela.
   */
  modal?: boolean;
}

/**
 * Sheet lateral de "novo incidente" (`Novo incidente · padrão / validação /
 * salvando`): duas colunas para categoria/criticidade e placa/motorista, o
 * resto em largura cheia, com o prazo real de atendimento no rodapé.
 */
export function CreateIncidentSheet({ open, onClose, modal = true }: CreateIncidentSheetProps) {
  const mutation = useCreateIncident();
  const isPending = mutation.isPending;

  const [form, setForm] = useState<CreateIncidentForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);

  /**
   * Veículo da frota confirmado no autocomplete.
   *
   * Guarda o modelo e a transportadora para a linha de confirmação abaixo do
   * campo — a placa identifica, mas quem está no rádio reconhece "Volvo FH 460
   * da Transbrasil" mais rápido do que um código de sete caracteres. Some assim
   * que a placa é editada: a confirmação vale para o que está no campo.
   */
  const [veiculoDaFrota, setVeiculoDaFrota] = useState<Vehicle | null>(null);

  /**
   * Quem abriu a sheet, para devolver o foco ao fechar. O Radix só restaura
   * sozinho quando existe um `DrawerTrigger`; aqui o gatilho vive na barra da
   * triagem, então a captura acontece no autoFocus, antes de o foco entrar no
   * painel.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  // Reabrir a sheet sempre começa de um formulário limpo.
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setSummary(null);
    setVeiculoDaFrota(null);
  }, [open]);

  /**
   * Sugestões de placa, consultadas enquanto a sheet está aberta.
   *
   * O termo é o que já está no campo: com o campo vazio a consulta devolve os
   * primeiros da frota, então a lista aparece ao focar — e não vazia, que
   * pareceria campo quebrado.
   */
  const frota = useVehicleSearch(form.truckPlate, open);

  const opcoesDePlaca = (frota.data?.items ?? []).map((veiculo) => ({
    value: veiculo.plate,
    label: veiculo.plate,
    description: `${veiculo.model} · ${veiculo.carrier}`,
  }));

  /**
   * Sugestões de local, tiradas dos incidentes que o usuário **já pode ver**.
   *
   * O recorte por papel não é reimplementado aqui: a busca reusa `GET /incidents`,
   * que aplica `visibility_scope` na query. Um `REPORTER` recebe sugestões apenas
   * dos próprios incidentes — e isso vale para o histórico inteiro, não só para a
   * página que ele tem aberta.
   */
  const locaisSugeridos = useLocationSuggestions(form.locationLabel, open);

  const opcoesDeLocal = locaisSugeridos.map((local) => ({ value: local, label: local }));

  const patchForm = (patch: Partial<CreateIncidentForm>): void => {
    setForm((previous) => ({ ...previous, ...patch }));
  };

  /** `422` com campos identificados volta para o campo; o resto vira aviso geral. */
  const applyServerError = (error: unknown): void => {
    const issues = readIncidentFieldErrors(error);
    const first = issues[0];
    if (first === undefined) {
      setFieldErrors({});
      setSummary(isApiError(error) ? error.message : 'Não foi possível criar o incidente.');
      return;
    }

    const errors: FieldErrors = {};
    for (const issue of issues) errors[issue.field] = issue.message;
    setFieldErrors(errors);
    setSummary(summarizeInvalidFields(issues.length));
    focusControl(first.field);
  };

  const submit = (): void => {
    if (isPending) return;

    const parsed = incidentCreateSchema.safeParse(form);
    if (!parsed.success) {
      const errors = mapIssuesToFields(parsed.error);
      setFieldErrors(errors);
      setSummary(summarizeInvalidFields(Object.keys(errors).length));
      focusFirstInvalid(errors);
      return;
    }

    setFieldErrors({});
    setSummary(null);
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        onClose();
      },
      onError: (error) => {
        applyServerError(error);
      },
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  /**
   * `Ctrl/Cmd + Enter` envia de qualquer ponto do painel. O listener fica na
   * janela (e não no `<form>`) porque o listbox do `Select` é renderizado em
   * portal, fora da árvore do formulário.
   */
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      submitRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <Drawer
      open={open}
      modal={modal}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent
        aria-busy={isPending}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          openerRef.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current?.focus();
        }}
      >
        <header className="flex flex-col gap-1 border-b border-border px-8 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
              Novo incidente
            </span>
            <DrawerCloseButton onClose={onClose} label="Fechar o formulário de novo incidente" />
          </div>
          <DrawerTitle className="text-lg">Registrar incidente</DrawerTitle>
          <DrawerDescription>
            Entra na fila já priorizado, com o prazo de atendimento contando a partir de agora.
          </DrawerDescription>
        </header>

        <form
          noValidate
          aria-busy={isPending}
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 py-5">
            {summary === null ? null : (
              <p
                id={SUMMARY_ID}
                role="alert"
                className="flex items-center gap-3 rounded-sm bg-danger-soft px-3 py-3 text-sm text-danger-text"
              >
                <CircleAlert className="h-6 w-6 shrink-0" aria-hidden="true" />
                {summary}
              </p>
            )}

            <FieldShell
              field="title"
              label="Título do incidente"
              required
              hint="3 a 120 caracteres — é o que aparece na lista"
              error={fieldErrors.title}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  value={form.title}
                  disabled={isPending}
                  placeholder="Ex.: Colisão com veículo na pista"
                  className={cn(fieldErrors.title !== undefined && 'border-danger')}
                  onChange={(event) => {
                    patchForm({ title: event.target.value });
                  }}
                />
              )}
            </FieldShell>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldShell field="category" label="Categoria" required error={fieldErrors.category}>
                {(a11y) => (
                  <Select
                    value={form.category}
                    disabled={isPending}
                    onValueChange={(value) => {
                      patchForm({ category: toCategory(value) });
                    }}
                  >
                    <SelectTrigger
                      {...a11y}
                      aria-required
                      className={cn(
                        'w-full',
                        fieldErrors.category !== undefined && 'border-danger',
                      )}
                    >
                      <SelectValue placeholder="Selecione a categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      {INCIDENT_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>

              <FieldShell
                field="criticality"
                label="Criticidade"
                required
                error={fieldErrors.criticality}
              >
                {(a11y) => (
                  <Select
                    value={form.criticality}
                    disabled={isPending}
                    onValueChange={(value) => {
                      patchForm({ criticality: toCriticality(value) });
                    }}
                  >
                    <SelectTrigger
                      {...a11y}
                      aria-required
                      className={cn(
                        'w-full',
                        fieldErrors.criticality !== undefined && 'border-danger',
                      )}
                    >
                      <SelectValue placeholder="Selecione a criticidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {INCIDENT_CRITICALITIES.map((criticality) => (
                        <SelectItem key={criticality} value={criticality}>
                          {CRITICALITY_LABELS[criticality]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            </div>

            <FieldShell
              field="description"
              label="Descrição"
              hint="Opcional — detalhes ajudam o analista a dimensionar a resposta."
              error={fieldErrors.description}
              trailing={
                <span className="font-mono text-2xs nums text-fg-subtle">
                  {`${String(form.description.length)} / 2000`}
                </span>
              }
            >
              {(a11y) => (
                <textarea
                  {...a11y}
                  rows={3}
                  value={form.description}
                  disabled={isPending}
                  placeholder="O que aconteceu, onde e como…"
                  className={cn(
                    'w-full rounded-sm border border-border bg-surface p-2 text-sm text-fg placeholder:text-fg-subtle',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    fieldErrors.description !== undefined && 'border-danger',
                  )}
                  onChange={(event) => {
                    patchForm({ description: event.target.value });
                  }}
                />
              )}
            </FieldShell>

            <FieldShell
              field="locationLabel"
              label="Local"
              hint="Opcional — entra na busca e no contexto do atendimento"
              error={fieldErrors.locationLabel}
            >
              {(a11y) => (
                <Combobox
                  {...a11y}
                  value={form.locationLabel}
                  disabled={isPending}
                  placeholder="BR-116 km 412, sentido São Paulo"
                  options={opcoesDeLocal}
                  // Sem `emptyMessage`: enquanto a pessoa digita um local que não
                  // está no histórico, nenhum painel aparece. Sugestão aqui é
                  // atalho, não lista fechada — o campo continua livre.
                  onValueChange={(valor) => {
                    patchForm({ locationLabel: valor });
                  }}
                />
              )}
            </FieldShell>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldShell
                field="truckPlate"
                label="Placa do veículo"
                hint="Mercosul (AAA1A23) ou antiga — a lista sugere as placas da frota"
                error={fieldErrors.truckPlate}
              >
                {(a11y) => (
                  <div className="flex flex-col gap-1">
                    <Combobox
                      {...a11y}
                      value={form.truckPlate}
                      disabled={isPending}
                      placeholder="AAA1A23"
                      options={opcoesDePlaca}
                      isLoading={frota.isFetching}
                      emptyMessage="Nenhuma placa encontrada na frota."
                      loadingMessage="Buscando placas…"
                      uppercase
                      onValueChange={(valor) => {
                        patchForm({ truckPlate: valor });
                        // Editou a placa: a confirmação anterior não descreve
                        // mais o que está no campo.
                        setVeiculoDaFrota(null);
                      }}
                      onSelect={(opcao) => {
                        setVeiculoDaFrota(
                          frota.data?.items.find((veiculo) => veiculo.plate === opcao.value) ??
                            null,
                        );
                      }}
                    />
                    {veiculoDaFrota === null ? null : (
                      <p className="text-2xs text-fg-subtle">
                        {veiculoDaFrota.model} · {veiculoDaFrota.carrier}
                      </p>
                    )}
                  </div>
                )}
              </FieldShell>

              <FieldShell
                field="driverName"
                label="Motorista"
                hint="Como consta na CNH"
                error={fieldErrors.driverName}
              >
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={form.driverName}
                    disabled={isPending}
                    placeholder="Nome do condutor"
                    className={cn(fieldErrors.driverName !== undefined && 'border-danger')}
                    onChange={(event) => {
                      patchForm({ driverName: event.target.value });
                    }}
                  />
                )}
              </FieldShell>
            </div>

            <FieldShell
              field="reportedBy"
              label="Reportado por"
              required
              hint="Canal de origem — rádio, app, concessionária, PRF…"
              error={fieldErrors.reportedBy}
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  value={form.reportedBy}
                  disabled={isPending}
                  placeholder="Ex.: Rádio Frota 12"
                  className={cn(fieldErrors.reportedBy !== undefined && 'border-danger')}
                  onChange={(event) => {
                    patchForm({ reportedBy: event.target.value });
                  }}
                />
              )}
            </FieldShell>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-8 py-4">
            <p className="text-2xs text-fg-subtle">
              Prazo de atendimento a partir da criação — ALTA 2 h · MÉDIA 8 h · BAIXA 24 h
            </p>
            <div className="flex items-center gap-3">
              <Button variant="secondary" disabled={isPending} onClick={onClose}>
                <X className="h-4 w-4" aria-hidden="true" />
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Criando…
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Criar incidente
                  </>
                )}
              </Button>
            </div>
          </footer>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Formulário                                                          */
/* ------------------------------------------------------------------ */

/** Estado local: os enums começam em `''` até a escolha no `Select`. */
interface CreateIncidentForm {
  title: string;
  category: IncidentCategory | '';
  criticality: IncidentCriticality | '';
  description: string;
  locationLabel: string;
  truckPlate: string;
  driverName: string;
  reportedBy: string;
}

const EMPTY_FORM: CreateIncidentForm = {
  title: '',
  category: '',
  criticality: '',
  description: '',
  locationLabel: '',
  truckPlate: '',
  driverName: '',
  reportedBy: '',
};

type FieldErrors = Partial<Record<CreateIncidentField, string>>;

const SUMMARY_ID = 'create-incident-summary';

/** `''` (vazio) não é opção do enum: o valor só entra depois da escolha no Select. */
function toCategory(value: string): IncidentCategory | '' {
  return INCIDENT_CATEGORIES.find((category) => category === value) ?? '';
}

function toCriticality(value: string): IncidentCriticality | '' {
  return INCIDENT_CRITICALITIES.find((criticality) => criticality === value) ?? '';
}

function fieldId(field: CreateIncidentField): string {
  return `create-incident-${field}`;
}

function errorId(field: CreateIncidentField): string {
  return `${fieldId(field)}-error`;
}

function hintId(field: CreateIncidentField): string {
  return `${fieldId(field)}-hint`;
}

function summarizeInvalidFields(count: number): string {
  return count === 1
    ? '1 campo precisa de atenção antes de criar o incidente.'
    : `${String(count)} campos precisam de atenção antes de criar o incidente.`;
}

/** Primeiro erro de cada campo, na ordem dos `issues` do Zod. */
function mapIssuesToFields(error: ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = CREATE_INCIDENT_FIELDS.find((candidate) => candidate === issue.path[0]);
    if (field === undefined || errors[field] !== undefined) continue;
    errors[field] = issue.message;
  }
  return errors;
}

function focusControl(field: CreateIncidentField): void {
  document.getElementById(fieldId(field))?.focus();
}

/** O primeiro campo inválido na ordem visual recebe o foco. */
function focusFirstInvalid(errors: FieldErrors): void {
  const field = CREATE_INCIDENT_FIELDS.find((candidate) => errors[candidate] !== undefined);
  if (field !== undefined) focusControl(field);
}

/** Atributos de rótulo/erro do controle — iguais para `Input`, `Select` e `textarea`. */
interface ControlA11y {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface FieldShellProps {
  field: CreateIncidentField;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  /** Conteúdo à direita do rótulo (ex.: contador de caracteres). */
  trailing?: ReactNode;
  children: (a11y: ControlA11y) => ReactNode;
}

/**
 * Rótulo + controle + dica/erro. O erro toma a posição da dica (como no frame
 * `Novo incidente · validação`) e vira o `aria-describedby` do controle.
 */
function FieldShell({
  field,
  label,
  required = false,
  error,
  hint,
  trailing,
  children,
}: FieldShellProps) {
  const describedBy =
    error === undefined ? (hint === undefined ? undefined : hintId(field)) : errorId(field);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={fieldId(field)} className="text-sm font-medium text-fg">
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
        {trailing}
      </div>

      {children({
        id: fieldId(field),
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy,
      })}

      {error === undefined ? (
        hint === undefined ? null : (
          <p id={hintId(field)} className="text-2xs text-fg-subtle">
            {hint}
          </p>
        )
      ) : (
        <p id={errorId(field)} className="text-2xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
