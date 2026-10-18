"""Schemas de leitura da frota."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VehicleRead(BaseModel):
    """Um caminhão da frota, com o que o autocomplete precisa mostrar.

    Os três campos existem para **confirmar a escolha**, não só para listar: a
    placa identifica, o modelo e a transportadora confirmam. Quem está no rádio
    reconhece "Volvo FH 460 da Transbrasil" mais rápido do que reconhece um
    código de sete caracteres.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    plate: str
    model: str
    carrier: str


class VehicleSearchResponse(BaseModel):
    """Resultado de uma busca de placas.

    `total` é o tamanho da frota, não o da página. Vai junto porque a interface
    precisa dizer o universo — "mostrando 8 de 5.000" comunica que a busca está
    filtrando, enquanto uma lista de 8 sem contexto parece a frota inteira.
    """

    items: list[VehicleRead] = Field(description="Veículos que casam com o prefixo.")
    total: int = Field(description="Quantos veículos existem na frota.")
