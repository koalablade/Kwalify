/**
 * In-memory vector store (v0). Hooks for pgvector / Pinecone / Weaviate later.
 */

import { cosineSimilarity, EMBEDDING_DIM } from "./genre-embeddings";

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorStoreHooks {
  /** Optional external persistence — not implemented */
  onUpsert?: (record: VectorRecord) => Promise<void>;
  onSearch?: (query: number[], k: number) => Promise<VectorRecord[]>;
}

export class VectorStore {
  private records = new Map<string, VectorRecord>();
  readonly dim: number;

  constructor(
    dim = EMBEDDING_DIM,
    private hooks: VectorStoreHooks = {}
  ) {
    this.dim = dim;
  }

  upsert(id: string, vector: number[], metadata?: Record<string, unknown>): void {
    this.records.set(id, { id, vector, metadata });
    void this.hooks.onUpsert?.({ id, vector, metadata });
  }

  get(id: string): VectorRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  size(): number {
    return this.records.size;
  }

  /** Top-k by cosine similarity */
  search(query: number[], k = 10, filter?: (r: VectorRecord) => boolean): VectorRecord[] {
    const scored: { record: VectorRecord; sim: number }[] = [];
    for (const record of this.records.values()) {
      if (filter && !filter(record)) continue;
      scored.push({ record, sim: cosineSimilarity(query, record.vector) });
    }
    return scored
      .sort((a, b) => b.sim - a.sim)
      .slice(0, k)
      .map((s) => s.record);
  }

  all(): VectorRecord[] {
    return [...this.records.values()];
  }

  /** For future pgvector sync */
  exportSnapshot(): VectorRecord[] {
    return this.all();
  }
}
