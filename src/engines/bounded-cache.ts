/** FIFO cache: bounded memory entries without updating Map order on every hit. */
export class BoundedCache<K, V> extends Map<K, V> {
  constructor(private readonly limit: number) {
    super();
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("maxCacheSize must be a positive safe integer");
    }
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    if (this.size > this.limit) {
      const oldest = this.keys().next();
      if (!oldest.done) this.delete(oldest.value);
    }
    return this;
  }
}
