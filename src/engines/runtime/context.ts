/**
 * Runtime Context
 * 
 * Quản lý scope và variables trong template execution.
 * Hỗ trợ nested scopes cho loops và includes.
 */

export class RuntimeContext {
  private data: Map<string, any>;
  private parent?: RuntimeContext;

  constructor(data: Record<string, any> = {}, parent?: RuntimeContext) {
    this.data = new Map(Object.entries(data));
    this.parent = parent;
  }

  /**
   * Get variable value, với lookup chain lên parent
   */
  get(key: string): any {
    if (this.data.has(key)) {
      return this.data.get(key);
    }
    
    // Lookup parent context
    if (this.parent) {
      return this.parent.get(key);
    }
    
    return undefined;
  }

  /**
   * Set variable value (chỉ trong current scope)
   */
  set(key: string, value: any): void {
    this.data.set(key, value);
  }

  /**
   * Check if variable exists
   */
  has(key: string): boolean {
    return this.data.has(key) || (this.parent?.has(key) ?? false);
  }

  /**
   * Create child context (for loops, includes)
   */
  createChild(data: Record<string, any> = {}): RuntimeContext {
    return new RuntimeContext(data, this);
  }

  /**
   * Convert context to plain object (for expression evaluation)
   */
  toObject(): Record<string, any> {
    const result: Record<string, any> = {};
    
    // Include parent data first
    if (this.parent) {
      Object.assign(result, this.parent.toObject());
    }
    
    // Override with current scope data
    for (const [key, value] of this.data.entries()) {
      result[key] = value;
    }
    
    return result;
  }

  /**
   * Get all keys in context (including parent)
   */
  keys(): string[] {
    const keys = new Set<string>();
    
    if (this.parent) {
      this.parent.keys().forEach(k => keys.add(k));
    }
    
    for (const key of this.data.keys()) {
      keys.add(key);
    }
    
    return Array.from(keys);
  }

  /**
   * Clear current scope (keep parent)
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Clone context
   */
  clone(): RuntimeContext {
    const cloned = new RuntimeContext({}, this.parent);
    for (const [key, value] of this.data.entries()) {
      cloned.set(key, value);
    }
    return cloned;
  }
}
