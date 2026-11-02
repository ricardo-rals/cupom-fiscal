import re
import subprocess
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from ai.main import app
from ai.nfce import consulta

RAIZ = Path(__file__).parents[3]
FIXTURES = Path(__file__).parent / "fixtures"
HTML = (FIXTURES / "nfce_ba/cupom_1.html").read_text(encoding="utf-8")
MARCADOR = "000.000.000-00"  # inválido de propósito: nunca é o CPF de alguém
URL = "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=2926|2|1|1|ABC"

PADRAO_CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
IGNORADOS = {"package-lock.json", "uv.lock", "favicon.ico"}


def _digito(digitos: str) -> str:
    peso = len(digitos) + 1
    resto = sum(int(d) * (peso - i) for i, d in enumerate(digitos)) * 10 % 11
    return str(resto % 10)


def _cpf_valido(numero: str) -> bool:
    digitos = re.sub(r"\D", "", numero)
    if len(set(digitos)) == 1:
        return False
    base = digitos[:9]
    primeiro = _digito(base)
    return digitos[9:] == primeiro + _digito(base + primeiro)


def encontrar_cpfs(texto: str) -> list[str]:
    return [m for m in PADRAO_CPF.findall(texto) if _cpf_valido(m)]


def test_detector_acha_cpf_com_e_sem_pontuacao() -> None:
    # Montado em tempo de execução para o número nunca ficar gravado no repositório.
    base = "123456789"
    primeiro = _digito(base)
    numero = base + primeiro + _digito(base + primeiro)
    formatado = f"{numero[:3]}.{numero[3:6]}.{numero[6:9]}-{numero[9:]}"

    assert encontrar_cpfs(f"CPF: {formatado}") == [formatado]
    assert encontrar_cpfs(f"cpf={numero}") == [numero]
    assert encontrar_cpfs(MARCADOR) == []
    assert encontrar_cpfs("2926" + "0" * 40) == []


def test_nenhum_arquivo_do_repositorio_tem_cpf() -> None:
    # Inclui arquivos ainda não commitados; o que o .gitignore esconde fica de fora.
    arquivos = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    assert arquivos

    com_cpf = [
        nome
        for nome in arquivos
        if Path(nome).name not in IGNORADOS
        and (RAIZ / nome).is_file()
        and encontrar_cpfs((RAIZ / nome).read_text(encoding="utf-8", errors="ignore"))
    ]
    assert com_cpf == []


def test_fixtures_nao_guardam_viewstate() -> None:
    # O __VIEWSTATE da Sefaz é uma cópia da nota em base64, com CPF e tudo.
    for fixture in FIXTURES.rglob("*.html"):
        assert "/wE" not in fixture.read_text(encoding="utf-8"), fixture.name


@pytest.mark.parametrize(
    ("html", "status"),
    [
        (HTML.replace("***.***.***-**", MARCADOR), 200),
        (f"<html><body>CPF: {MARCADOR}</body></html>", 422),
    ],
    ids=["cupom-valido", "layout-desconhecido"],
)
def test_cpf_da_pagina_nao_chega_a_resposta_nem_aos_logs(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    html: str,
    status: int,
) -> None:
    assert MARCADOR in html
    transporte = httpx.MockTransport(lambda _: httpx.Response(200, text=html))
    consultar_real = consulta.consultar
    monkeypatch.setattr(
        "ai.main.consultar", lambda url: consultar_real(url, transporte)
    )
    caplog.set_level("DEBUG")

    resposta = TestClient(app).post("/nfce/parse", json={"url": URL})

    assert resposta.status_code == status
    saida = capfd.readouterr()
    assert MARCADOR not in resposta.text
    assert MARCADOR not in caplog.text
    assert MARCADOR not in saida.out + saida.err
