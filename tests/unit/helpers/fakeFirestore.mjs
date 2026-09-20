// Firestore Admin em memória para testes de server/backup-operations.js.
// Implementa somente o que o núcleo usa: collection().get(), collection().doc(), batch().
// Não acessa rede nem Firebase real.

export const BASE_PATH = 'artifacts/gestao-de-ferramentas-3f8f1/public/data';
export const BATCH_LIMIT = 500;

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  // Timestamps e demais instâncias são imutáveis neste contexto.
  return value;
}

export class FakeFirestore {
  /**
   * @param {Record<string, Array<{id: string, data: object}>>} initial
   * @param {Record<number, {mode: 'throw-before'|'throw-after'|'after-apply', run?: Function}>} failures
   *        indexado pelo número do commit (0 = primeiro commit).
   */
  constructor(initial = {}, failures = {}) {
    this.collections = new Map();
    this.failures = failures;
    this.commits = [];

    for (const [name, documents] of Object.entries(initial)) {
      this.collections.set(
        `${BASE_PATH}/${name}`,
        new Map(documents.map((document) => [document.id, cloneValue(document.data)]))
      );
    }
  }

  _store(path) {
    if (!this.collections.has(path)) {
      this.collections.set(path, new Map());
    }

    return this.collections.get(path);
  }

  collection(path) {
    const store = () => this._store(path);

    return {
      get: async () => {
        const docs = [...store().entries()].map(([id, data]) => ({
          id,
          data: () => cloneValue(data),
        }));

        return { docs, size: docs.length };
      },
      doc: (id) => ({ collectionPath: path, id }),
    };
  }

  batch() {
    const operations = [];

    return {
      set: (ref, data) => operations.push({ type: 'set', ref, data }),
      delete: (ref) => operations.push({ type: 'delete', ref }),
      commit: async () => this._commit(operations),
    };
  }

  _commit(operations) {
    const index = this.commits.length;
    const failure = this.failures[index];

    this.commits.push({
      count: operations.length,
      sets: operations.filter((operation) => operation.type === 'set').length,
      deletes: operations.filter((operation) => operation.type === 'delete').length,
      paths: [...new Set(operations.map((operation) => operation.ref.collectionPath))],
    });

    if (operations.length > BATCH_LIMIT) {
      throw new Error('batch acima do limite');
    }

    if (failure?.mode === 'throw-before') {
      throw new Error('falha de transporte antes de aplicar');
    }

    for (const operation of operations) {
      const store = this._store(operation.ref.collectionPath);

      if (operation.type === 'set') {
        store.set(operation.ref.id, cloneValue(operation.data));
      } else {
        store.delete(operation.ref.id);
      }
    }

    failure?.run?.(this);

    if (failure?.mode === 'throw-after') {
      throw new Error('falha de transporte depois de aplicar');
    }

    return Promise.resolve();
  }

  dump(name) {
    return [...this._store(`${BASE_PATH}/${name}`).entries()]
      .map(([id, data]) => ({ id, data: cloneValue(data) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  put(name, id, data) {
    this._store(`${BASE_PATH}/${name}`).set(id, cloneValue(data));
  }
}
