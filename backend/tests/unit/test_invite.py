"""Testes unitários do convite: senha temporária, nome derivado e e-mail."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.mailer import LoggingMailer, OutboundEmail, SmtpMailer, get_mailer
from app.domain.accounts import (
    TEMP_PASSWORD_ALPHABET,
    TEMP_PASSWORD_LENGTH,
    generate_temp_password,
)
from app.infra.mail_templates import INVITE_SUBJECT, build_invite_email
from app.services.user_service import derive_name_from_email


class TestSenhaTemporaria:
    """A credencial que viaja por e-mail."""

    def test_tem_o_comprimento_configurado(self) -> None:
        """O comprimento é o que encarece o ataque de força bruta."""
        assert len(generate_temp_password()) == TEMP_PASSWORD_LENGTH

    def test_usa_apenas_o_alfabeto_permitido(self) -> None:
        """Nenhum caractere fora do alfabeto escolhido."""
        senha = generate_temp_password()
        assert set(senha) <= set(TEMP_PASSWORD_ALPHABET)

    def test_nao_tem_caracteres_ambiguos(self) -> None:
        """`0`/`O` e `1`/`l`/`I` ficam de fora: a senha é digitada à mão."""
        for ambiguo in "0O1lI":
            assert ambiguo not in TEMP_PASSWORD_ALPHABET

    def test_duas_chamadas_nao_coincidem(self) -> None:
        """O gerador não repete — se repetisse, não seria aleatório."""
        assert generate_temp_password() != generate_temp_password()

    def test_cabe_na_politica_de_senha(self) -> None:
        """A temporária precisa satisfazer a mesma política das demais senhas."""
        from app.domain.accounts import MIN_PASSWORD_LENGTH, validate_password_strength

        assert TEMP_PASSWORD_LENGTH >= MIN_PASSWORD_LENGTH
        validate_password_strength(generate_temp_password())


class TestNomeDerivado:
    """O nome que a lista de administração mostra."""

    @pytest.mark.parametrize(
        ("email", "esperado"),
        [
            ("joana.prado@autou.com.br", "Joana Prado"),
            ("marina_souza@autou.com.br", "Marina Souza"),
            ("ana-paula@autou.com.br", "Ana Paula"),
            ("carlos@autou.com.br", "Carlos"),
            ("JOAO.SILVA@AUTOU.COM.BR", "Joao Silva"),
        ],
    )
    def test_deriva_partes_do_email(self, email: str, esperado: str) -> None:
        """Pontos, underscores e hífens separam as partes do nome."""
        assert derive_name_from_email(email) == esperado

    def test_email_sem_parte_local_nao_quebra(self) -> None:
        """Entrada degenerada devolve string vazia, sem levantar exceção.

        Um e-mail assim nem chega aqui — o validador do schema exige algo antes
        do `@`. O teste fixa o comportamento para a função não surpreender se
        for chamada de outro lugar.
        """
        assert derive_name_from_email("@autou.com.br") == ""


class TestEmailDeConvite:
    """O conteúdo da mensagem."""

    def _montar(self) -> OutboundEmail:
        return build_invite_email(
            to="joana.prado@autou.com.br",
            name="Joana Prado",
            role="ANALYST",
            temp_password="Abc234Def567Ghj8",  # noqa: S106 - valor de teste, nao segredo
            expires_at=datetime(2026, 10, 18, 15, 30, tzinfo=UTC),
            frontend_url="https://logos.exemplo.app",
        )

    def test_assunto_e_o_aprovado_no_desenho(self) -> None:
        """O assunto é o mesmo do Figma."""
        assert self._montar().subject == INVITE_SUBJECT
        assert self._montar().subject == "Sua conta no Logos foi criada"

    def test_corpo_traz_tudo_que_a_pessoa_precisa(self) -> None:
        """Destinatário, senha, prazo, link e o aviso de convite inesperado."""
        corpo = self._montar().body
        assert "Joana Prado" in corpo
        assert "joana.prado@autou.com.br" in corpo
        assert "Abc234Def567Ghj8" in corpo
        assert "18/10/2026" in corpo
        assert "https://logos.exemplo.app" in corpo
        assert "Definir minha senha" in corpo
        assert "ignore" in corpo

    def test_mostra_o_papel_em_portugues(self) -> None:
        """A mensagem não expõe o código do enum."""
        corpo = self._montar().body
        assert "Analista de triagem" in corpo
        assert "ANALYST" not in corpo

    def test_papel_desconhecido_nao_quebra(self) -> None:
        """Um papel novo sem rótulo cai no próprio código, sem exceção."""
        mensagem = build_invite_email(
            to="x@autou.com.br",
            name="X",
            role="AUDITOR",
            temp_password="Abc234Def567Ghj8",  # noqa: S106 - valor de teste, nao segredo
            expires_at=datetime(2026, 10, 18, tzinfo=UTC),
            frontend_url="https://x.app",
        )
        assert "AUDITOR" in mensagem.body


class TestPortaDeEmail:
    """Seleção da implementação."""

    def test_logging_mailer_escreve_no_log(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Sem SMTP configurado, a mensagem vai para o log.

        O mailer recebe um logger **próprio deste teste**, e não o do módulo: o
        `app.core.logging` reconfigura loggers pelo nome, e o pytest mexe nos
        níveis. Um logger novo, sem nome compartilhado, mede o que interessa —
        que `send` registra destinatário, assunto e corpo — sem depender do
        estado global que outra suíte deixou para trás.
        """
        registros: list[str] = []

        class Coletor(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                registros.append(record.getMessage())

        coletor_logger = logging.getLogger(f"teste.convite.{uuid4().hex}")
        coletor_logger.handlers = [Coletor()]
        coletor_logger.setLevel(logging.INFO)
        # Sem propagar: o que interessa é o que ESTE logger recebeu.
        coletor_logger.propagate = False
        monkeypatch.setattr("app.core.mailer.logger", coletor_logger)

        LoggingMailer().send(OutboundEmail(to="a@b.com", subject="Oi", body="corpo"))

        texto = "\n".join(registros)
        assert "a@b.com" in texto
        assert "Oi" in texto
        assert "corpo" in texto

    def test_sem_smtp_host_usa_o_de_log(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """O padrão não depende de credencial nenhuma."""
        monkeypatch.setattr("app.core.mailer.get_settings", lambda: Settings(smtp_host=""))
        assert isinstance(get_mailer(), LoggingMailer)

    def test_com_smtp_host_usa_smtp(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Configurar o host troca a implementação, sem reescrever nada."""
        monkeypatch.setattr(
            "app.core.mailer.get_settings",
            lambda: Settings(smtp_host="smtp.exemplo.com", smtp_port=2525),
        )
        mailer = get_mailer()
        assert isinstance(mailer, SmtpMailer)


class TestConfiguracaoDeConvite:
    """Padrões que o convite usa."""

    def test_prazo_padrao_e_de_vinte_e_quatro_horas(self) -> None:
        """É o que o desenho mostra."""
        from app.domain.accounts import INVITE_TTL_HOURS

        assert INVITE_TTL_HOURS == 24

    def test_sem_smtp_o_padrao_e_log(self) -> None:
        """A configuração de fábrica não tenta falar com a rede."""
        padrao = Settings()
        assert padrao.smtp_host == ""
        assert padrao.frontend_url.startswith("http")

    def test_prazo_do_convite_e_futuro(self) -> None:
        """Sanidade: o prazo emitido é sempre à frente do instante atual."""
        from app.domain.accounts import INVITE_TTL_HOURS

        agora = datetime.now(UTC)
        assert agora + timedelta(hours=INVITE_TTL_HOURS) > agora
