"""Acesso a dados da frota: busca por prefixo de placa."""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.vehicle import Vehicle


def escape_like(value: str) -> str:
    """Neutraliza os curingas do `LIKE` no texto digitado.

    O `escape=` do SQLAlchemy diz qual caractere de escape usar; ele **não**
    escapa o que a pessoa digitou. Sem esta função, digitar `%` devolveria a
    frota inteira e `_` casaria qualquer caractere — a busca deixaria de ser
    "placas que começam com o que eu digitei" e passaria a ser "qualquer coisa".

    A barra invertida vem primeiro: escapá-la depois transformaria o escape
    recém-inserido em `\\\\%`, que casa uma barra literal seguida de curinga.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class VehicleRepository:
    """Consultas de leitura sobre a frota.

    Só leitura: a frota é carga de dados, não algo que a aplicação edita. Não há
    `create` nem `update` aqui de propósito — quem popula é o `seed`, e um
    caminho de escrita sem caso de uso é superfície sem motivo.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def count(self) -> int:
        """Quantos veículos a frota tem."""
        return int(self._session.scalar(select(func.count()).select_from(Vehicle)) or 0)

    def clear(self) -> None:
        """Esvazia a frota.

        Existe para o isolamento da suíte, não para a aplicação: nada na API
        apaga veículo. A frota é carga de dados — quem a repõe é o `seed`.
        """
        self._session.execute(delete(Vehicle))
        self._session.commit()

    def search_by_plate_prefix(self, prefix: str, *, limit: int) -> list[Vehicle]:
        """Veículos cuja placa **começa** com `prefix`.

        Prefixo, e não "contém": é como se digita uma placa. `ABC` deve trazer
        `ABC1D23` e não `XABC123` — uma busca por substring encheria a lista de
        resultados que não têm relação com o que a pessoa está digitando.

        O `LIKE` é sensível a maiúsculas de propósito. A coluna guarda tudo em
        maiúsculas e o prefixo chega normalizado, então o índice da coluna é
        aproveitado; um `ILIKE` faria varredura completa da tabela.
        """
        statement = select(Vehicle).order_by(Vehicle.plate).limit(limit)
        if prefix:
            statement = statement.where(
                Vehicle.plate.like(f"{escape_like(prefix)}%", escape="\\")
            )
        return list(self._session.scalars(statement))
