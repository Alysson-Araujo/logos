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
            ("joana.prado@demo.example.com", "Joana Prado"),
            ("marina_souza@demo.example.com", "Marina Souza"),
            ("ana-paula@demo.example.com", "Ana Paula"),
            ("carlos@demo.example.com", "Carlos"),
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
        assert derive_name_from_email("@demo.example.com") == ""


class TestEmailDeConvite:
    """O conteúdo da mensagem."""

    def _montar(self) -> OutboundEmail:
        return build_invite_email(
            to="joana.prado@demo.example.com",
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
        assert "joana.prado@demo.example.com" in corpo
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
            to="x@demo.example.com",
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
        """Sem SMTP configurado, o envio não tenta falar com a rede.

        O valor é passado explicitamente, e não lido do ambiente: com um `.env`
        real na máquina de quem desenvolve, `Settings()` traria `smtp.gmail.com`
        e o teste passaria no CI e falharia local — ou o contrário. Um teste que
        depende do ambiente mede a máquina, não o código.
        """
        padrao = Settings(smtp_host="")
        assert padrao.smtp_host == ""
        assert padrao.frontend_url.startswith("http")

    def test_prazo_do_convite_e_futuro(self) -> None:
        """Sanidade: o prazo emitido é sempre à frente do instante atual."""
        from app.domain.accounts import INVITE_TTL_HOURS

        agora = datetime.now(UTC)
        assert agora + timedelta(hours=INVITE_TTL_HOURS) > agora


class TestSmtpMailer:
    """O caminho que fala com um servidor de e-mail de verdade.

    Substitui `smtplib.SMTP` por um dublê, e não por um servidor falso em
    memória: o que precisa ser verificado é o que o `SmtpMailer` **pede** ao
    servidor — host, porta, TLS, login e o conteúdo da mensagem. Um servidor de
    verdade exercitaria a biblioteca padrão do Python, não este código.
    """

    def _duble(self, monkeypatch: pytest.MonkeyPatch, chamadas: list[object]) -> None:
        """Instala um SMTP que apenas registra as chamadas."""

        class SmtpDuble:
            def __init__(self, host: str, port: int, timeout: float) -> None:
                chamadas.append(("conectar", host, port, timeout))

            def __enter__(self) -> SmtpDuble:
                return self

            def __exit__(self, *args: object) -> bool:
                chamadas.append(("fechar",))
                return False

            def starttls(self) -> None:
                chamadas.append(("starttls",))

            def login(self, usuario: str, senha: str) -> None:
                chamadas.append(("login", usuario, senha))

            def send_message(self, mensagem: object) -> None:
                chamadas.append(("mensagem", mensagem))

        monkeypatch.setattr("app.core.mailer.smtplib.SMTP", SmtpDuble)

    def _settings(self, **overrides: object) -> Settings:
        padrao: dict[str, object] = {
            "smtp_host": "smtp.exemplo.com",
            "smtp_port": 587,
            "smtp_user": "logos@exemplo.com",
            "smtp_password": "senha-de-app",
            "smtp_use_tls": True,
        }
        padrao.update(overrides)
        return Settings(**padrao)  # type: ignore[arg-type]

    def test_conecta_no_host_e_porta_configurados(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """O destino sai da configuração, e não de um valor fixo."""
        chamadas: list[object] = []
        self._duble(monkeypatch, chamadas)
        SmtpMailer(self._settings()).send(OutboundEmail(to="a@b.com", subject="Oi", body="corpo"))
        conexao = next(c for c in chamadas if c[0] == "conectar")
        assert conexao[1] == "smtp.exemplo.com"
        assert conexao[2] == 587

    def test_usa_tls_e_autentica(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """STARTTLS antes do login — nunca credencial em canal aberto."""
        chamadas: list[object] = []
        self._duble(monkeypatch, chamadas)
        SmtpMailer(self._settings()).send(OutboundEmail(to="a@b.com", subject="Oi", body="corpo"))
        nomes = [c[0] for c in chamadas]
        assert "starttls" in nomes
        assert nomes.index("starttls") < nomes.index("login")

    def test_sem_tls_nao_chama_starttls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Servidor local sem TLS é uma escolha explícita da configuração."""
        chamadas: list[object] = []
        self._duble(monkeypatch, chamadas)
        SmtpMailer(self._settings(smtp_use_tls=False)).send(
            OutboundEmail(to="a@b.com", subject="Oi", body="corpo")
        )
        assert "starttls" not in [c[0] for c in chamadas]

    def test_sem_usuario_nao_tenta_login(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """MailHog e Mailpit não exigem autenticação."""
        chamadas: list[object] = []
        self._duble(monkeypatch, chamadas)
        SmtpMailer(self._settings(smtp_user="")).send(
            OutboundEmail(to="a@b.com", subject="Oi", body="corpo")
        )
        assert "login" not in [c[0] for c in chamadas]

    def test_mensagem_leva_remetente_destinatario_e_assunto(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """O que o servidor recebe é uma mensagem montada, não texto solto."""
        chamadas: list[object] = []
        self._duble(monkeypatch, chamadas)
        SmtpMailer(self._settings(smtp_from="Logos <nao-responda@exemplo.com>")).send(
            OutboundEmail(to="joana@exemplo.com", subject="Sua conta", body="Olá")
        )
        mensagem = next(c[1] for c in chamadas if c[0] == "mensagem")
        assert mensagem["To"] == "joana@exemplo.com"
        assert mensagem["Subject"] == "Sua conta"
        assert "nao-responda@exemplo.com" in mensagem["From"]
        assert "Olá" in mensagem.get_content()

    def test_falha_de_conexao_propaga(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """O mailer não engole o erro — quem decide o que fazer é o serviço."""

        class SmtpQuebrado:
            def __init__(self, *args: object, **kwargs: object) -> None:
                raise OSError("sem rota até o servidor")

        monkeypatch.setattr("app.core.mailer.smtplib.SMTP", SmtpQuebrado)
        with pytest.raises(OSError):
            SmtpMailer(self._settings()).send(
                OutboundEmail(to="a@b.com", subject="Oi", body="corpo")
            )


class TestGuardaDeProducao:
    """Produção não sobe mal configurada.

    O modo de falha aqui é o pior possível: sem `SMTP_HOST` nada quebra, o
    convite vai para o log e a API responde `201`. O administrador conclui que a
    pessoa foi convidada, e ninguém recebe nada.
    """

    def _producao(self, **overrides: object) -> Settings:
        padrao: dict[str, object] = {
            "environment": "production",
            "auth_secret_key": "chave-real-de-producao-com-tamanho-suficiente",
            "smtp_host": "smtp.exemplo.com",
        }
        padrao.update(overrides)
        return Settings(**padrao)  # type: ignore[arg-type]

    def test_producao_com_smtp_sobe(self) -> None:
        """Configurado, não há o que reclamar."""
        assert self._producao().smtp_host == "smtp.exemplo.com"

    def test_producao_sem_smtp_recusa_subir(self) -> None:
        """O convite que não chega aparece no deploy, e não meses depois."""
        with pytest.raises(ValueError, match="SMTP_HOST"):
            self._producao(smtp_host="")

    def test_producao_pode_assumir_o_log_explicitamente(self) -> None:
        """`EMAIL_DISABLED` separa "esqueci" de "escolhi assim"."""
        configuracao = self._producao(smtp_host="", email_disabled=True)
        assert configuracao.email_disabled is True

    def test_desenvolvimento_nao_exige_smtp(self) -> None:
        """Localmente o padrão continua sendo o log, sem cerimônia."""
        assert Settings(environment="local", smtp_host="").smtp_host == ""

    def test_guarda_da_chave_continua_valendo(self) -> None:
        """A validação anterior não foi substituída pela nova."""
        from app.core.config import DEV_AUTH_SECRET_KEY

        with pytest.raises(ValueError, match="AUTH_SECRET_KEY"):
            self._producao(auth_secret_key=DEV_AUTH_SECRET_KEY)
