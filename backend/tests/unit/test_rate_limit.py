"""Matemática da janela deslizante, com o relógio injetado.

Testar o limitador pelo HTTP obrigaria a disparar dezenas de requisições e a
depender de tempo real. Com `now` injetado, cada caso é determinístico e roda em
microssegundos.
"""

from __future__ import annotations

from app.core.rate_limit import PRUNE_INTERVAL_SECONDS, SlidingWindowLimiter

WINDOW = 60.0


def test_aceita_ate_o_teto() -> None:
    limitador = SlidingWindowLimiter(limit=3, window_seconds=WINDOW)
    for instante in (0.0, 1.0, 2.0):
        assert limitador.check("cliente", now=instante) is None


def test_recusa_ao_passar_do_teto_e_informa_a_espera_exata() -> None:
    limitador = SlidingWindowLimiter(limit=3, window_seconds=WINDOW)
    for instante in (0.0, 1.0, 2.0):
        limitador.check("cliente", now=instante)

    espera = limitador.check("cliente", now=3.0)

    # A requisição mais antiga entrou em t=0 e sai da janela em t=60, então
    # faltam exatamente 57 segundos. É este número que vira o Retry-After.
    assert espera == 57.0


def test_a_janela_desliza_e_libera_espaco() -> None:
    limitador = SlidingWindowLimiter(limit=2, window_seconds=10.0)
    limitador.check("cliente", now=0.0)
    limitador.check("cliente", now=1.0)
    assert limitador.check("cliente", now=2.0) is not None

    # Em t=11 as duas marcas saíram da janela de 10 s, então há espaço de novo.
    assert limitador.check("cliente", now=11.0) is None


def test_janela_fixa_permitiria_o_dobro_e_a_deslizante_nao() -> None:
    """O caso que justifica a janela deslizante.

    Com janela fixa, gastar o teto nos últimos segundos de uma janela e de novo
    nos primeiros da seguinte passaria o dobro do limite em um instante curto.
    Na deslizante, o teto vale a qualquer momento.
    """
    limitador = SlidingWindowLimiter(limit=4, window_seconds=WINDOW)
    for instante in (58.0, 59.0, 60.0, 61.0):
        assert limitador.check("cliente", now=instante) is None

    # Já na "janela seguinte" do relógio, e ainda recusado.
    assert limitador.check("cliente", now=62.0) is not None


def test_clientes_distintos_tem_cotas_distintas() -> None:
    limitador = SlidingWindowLimiter(limit=1, window_seconds=WINDOW)
    assert limitador.check("10.0.0.1", now=0.0) is None
    assert limitador.check("10.0.0.2", now=0.0) is None
    assert limitador.check("10.0.0.1", now=1.0) is not None


def test_historico_de_clientes_inativos_e_descartado() -> None:
    """Sem a limpeza, um IP que apareceu uma vez ficaria no mapa para sempre."""
    limitador = SlidingWindowLimiter(limit=5, window_seconds=WINDOW)
    limitador.check("antigo", now=0.0)
    assert limitador.tracked_keys() == 1

    # Passado o intervalo de limpeza e a janela, a chave inativa sai do mapa.
    limitador.check("novo", now=PRUNE_INTERVAL_SECONDS + WINDOW + 1.0)

    assert limitador.tracked_keys() == 1
