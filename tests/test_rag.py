from backend import config
from backend.rag import llm
from backend.rag.ingest import chunk_text


def _c(d):
    return {"texto": "x", "fuente": "a.pdf", "seccion": "", "distancia": d}


def test_filtrar_sin_umbral_no_filtra():
    chunks = [_c(0.2), _c(1.5)]
    assert llm.filtrar_por_distancia(chunks, None) == chunks


def test_filtrar_descarta_lejanos_y_conserva_sin_distancia():
    chunks = [_c(0.5), _c(0.85), _c(0.9), _c(None)]
    res = llm.filtrar_por_distancia(chunks, 0.85)
    assert [c["distancia"] for c in res] == [0.5, 0.85, None]


def test_rewrite_sin_historial_devuelve_original(monkeypatch):
    monkeypatch.setattr(config, "REWRITE_QUERY", True)
    assert llm.rewrite_query("¿y cuando es?", None) == "¿y cuando es?"
    assert llm.rewrite_query("¿y cuando es?", []) == "¿y cuando es?"


def test_rewrite_desactivado_devuelve_original(monkeypatch):
    monkeypatch.setattr(config, "REWRITE_QUERY", False)
    hist = [{"role": "user", "content": "hola"}]
    assert llm.rewrite_query("¿y cuando es?", hist) == "¿y cuando es?"


def test_rewrite_usa_respuesta_del_llm(monkeypatch):
    monkeypatch.setattr(config, "REWRITE_QUERY", True)

    class _Msg: content = '"fecha de recepcion de solicitudes de movilidad"\notra linea'
    class _Choice: message = _Msg()
    class _Comp: choices = [_Choice()]
    class _Chat:
        class completions:
            @staticmethod
            def create(**kw):
                return _Comp()
    class _Client: chat = _Chat()

    monkeypatch.setattr(llm, "get_client", lambda: _Client())
    hist = [{"role": "user", "content": "movilidad de carrera"}]
    assert llm.rewrite_query("¿y cuando es?", hist) == "fecha de recepcion de solicitudes de movilidad"


def test_rewrite_ante_error_cae_a_la_pregunta_original(monkeypatch):
    monkeypatch.setattr(config, "REWRITE_QUERY", True)

    def boom():
        raise RuntimeError("sin red")

    monkeypatch.setattr(llm, "get_client", boom)
    hist = [{"role": "user", "content": "movilidad"}]
    assert llm.rewrite_query("¿y cuando es?", hist) == "¿y cuando es?"


def test_chunk_text_no_parte_contactos():
    texto = "## Contacto\nEscribe a secretaria@utm.edu.ec o llama al 05 2 6 23 456.\n" + ("x " * 600)
    frags = chunk_text(texto, chunk_size=300)
    assert any("secretaria@utm.edu.ec" in f["texto"] for f in frags)
