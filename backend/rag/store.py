"""
Cliente de la base de datos vectorial (ChromaDB) compartido por todo el backend.
Guarda los fragmentos de los documentos ya convertidos en vectores (embeddings)
para poder buscar por similitud semantica cuando un estudiante pregunta algo.
"""
import chromadb
from chromadb.utils import embedding_functions

from backend import config

_client = None
_collection = None


def get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=config.CHROMA_PATH)
        embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=config.EMBEDDING_MODEL
        )
        _collection = _client.get_or_create_collection(
            name=config.COLLECTION_NAME,
            embedding_function=embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def reset_collection():
    """Borra la coleccion completa y la vuelve a crear vacia. Se usa al
    reindexar todos los documentos desde cero."""
    global _collection
    collection = get_collection()
    _client.delete_collection(collection.name)
    _collection = None
    return get_collection()
