import pytest
from fastapi import HTTPException

from backend import admin, config


def test_sin_token_configurado_falla_cerrado(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_TOKEN", "")
    monkeypatch.setattr(config, "ALLOW_INSECURE_ADMIN", False)
    with pytest.raises(HTTPException) as e:
        admin.verificar_token(None)
    assert e.value.status_code == 503


def test_sin_token_con_optin_inseguro_permite(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_TOKEN", "")
    monkeypatch.setattr(config, "ALLOW_INSECURE_ADMIN", True)
    assert admin.verificar_token(None) is None


def test_token_correcto_e_incorrecto(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_TOKEN", "secreto")
    assert admin.verificar_token("secreto") is None
    for malo in (None, "", "otro"):
        with pytest.raises(HTTPException) as e:
            admin.verificar_token(malo)
        assert e.value.status_code == 401


def test_subida_fallida_conserva_version_anterior(monkeypatch, tmp_path):
    import asyncio, io
    from starlette.datastructures import UploadFile

    monkeypatch.setattr(admin, "DOCS_DIR", tmp_path)
    original = b"contenido bueno"
    (tmp_path / "doc.txt").write_bytes(original)

    calls = []

    def fake_index(path):
        calls.append(path)
        if len(calls) == 1:  # el intento con el archivo nuevo falla
            raise ValueError("corrupto")
        return 1

    monkeypatch.setattr(admin, "index_document", fake_index)
    monkeypatch.setattr(admin, "_listar_documentos", lambda: type("R", (), {"total_fragmentos": 0})())

    up = UploadFile(file=io.BytesIO(b"basura"), filename="doc.txt")
    res = asyncio.run(admin.subir_documentos([up]))
    assert res.archivos[0].estado == "error"
    assert (tmp_path / "doc.txt").read_bytes() == original
    assert len(calls) == 2  # se intento restaurar el indice previo


def test_nombre_seguro_quita_rutas():
    assert admin._nombre_seguro("../../etc/passwd.txt") == "passwd.txt"
