import chromadb
from app.config import settings


class VectorDBManager:
    """Manages semantic memory using local ChromaDB collections and vector search."""

    def __init__(self):
        self.client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)
        self.collection = self.client.get_or_create_collection(name="nightai_memories")

    def add_memory(self, doc_id: str, text: str, metadata: dict | None = None):
        """Stores a textual memory alongside metadata for semantic retrieval."""
        self.collection.add(
            documents=[text],
            ids=[doc_id],
            metadatas=[metadata] if metadata else None
        )

    def query_memories(self, query_text: str, limit: int = 5) -> dict:
        """Performs a vector search query to find the top matching memories."""
        results = self.collection.query(
            query_texts=[query_text],
            n_results=limit
        )
        return results
