"""Modelo ORM do caminhão da frota acompanhada."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Vehicle(Base, TimestampMixin):
    """Caminhão da frota que a central acompanha.

    Existe para o **autocomplete de placa**. Com 5.000 veículos, ninguém digita
    uma placa de memória sem errar — e uma placa errada no incidente é um
    registro que não serve para nada depois.

    **Por que o incidente não tem chave estrangeira para cá.** A frota é fonte
    de *sugestão*, não autoridade sobre o incidente. Duas razões concretas:

    1. Um incidente pode envolver um caminhão de terceiro, que nunca estará
       nesta tabela. Com chave estrangeira, esse caso viraria um erro de
       validação — e o operador de rádio não teria como registrar o que viu.
    2. A frota muda. Um veículo vendido sai do cadastro; o incidente que ele
       teve em março continua sendo um fato. Apagar o cadastro não pode
       reescrever o histórico.

    A placa do incidente é um fato registrado no momento. A placa daqui é um
    cadastro que se mantém.
    """

    __tablename__ = "vehicles"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)

    #: Padrão Mercosul (AAA1A23) ou antigo (AAA1234), sempre em MAIÚSCULAS.
    #:
    #: Único porque a mesma placa não pode existir duas vezes na frota — e
    #: indexado porque a busca é sempre por prefixo (`ABC%`), que é como se
    #: digita uma placa. Guardar em maiúsculas é o que permite usar o índice
    #: nessa busca: um `ILIKE` não o aproveitaria.
    plate: Mapped[str] = mapped_column(String(8), nullable=False, unique=True, index=True)

    #: Modelo comercial do veículo ("Volvo FH 460").
    model: Mapped[str] = mapped_column(String(80), nullable=False)

    #: Transportadora responsável. É o que dá contexto ao autocomplete: saber
    #: de quem é o caminhão ajuda a confirmar que a placa digitada é a certa.
    carrier: Mapped[str] = mapped_column(String(120), nullable=False)
