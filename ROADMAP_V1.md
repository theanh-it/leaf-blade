# 🚀 Roadmap v1.0.0 - Remove EJS Dependency

## 🎯 Goal
Remove EJS dependency and implement native Blade runtime interpreter.

## 📊 Current State (v0.0.4)
- ✅ Lexer complete
- ✅ Parser complete  
- ✅ AST definitions complete
- ✅ CodeGenerator (outputs EJS)
- ⚠️ Renderer uses EJS for evaluation
- ⚠️ Bundle includes EJS (~60KB)

## 🎯 Target State (v1.0.0)
- ✅ Lexer (no changes)
- ✅ Parser (no changes)
- ✅ AST (no changes)
- 🆕 BladeRuntime - Native interpreter
- 🆕 BladeRendererV2 - Uses runtime instead of EJS
- ❌ Remove EJS dependency
- 📦 Reduce bundle size by ~60KB

---

## 📋 Implementation Tasks

### Phase 1: Core Runtime (Week 1-2)
**Estimated: 800-1000 LOC**

#### Task 1.1: Create BladeRuntime class
**File**: `src/engines/runtime.ts`
```typescript
export class BladeRuntime {
  // Core evaluation engine
  async evaluate(ast: ASTNode[], context: Context): Promise<string>
  private evaluateNode(node: ASTNode, context: Context): Promise<string>
  
  // Expression evaluation
  private evaluateExpression(expr: string, context: any): any
  private createSafeEvaluator(expr: string): Function
  
  // HTML escaping
  private escapeHtml(value: any): string
  
  // Utility
  private coerceToString(value: any): string
}
```

**Features**:
- [x] Text node rendering
- [x] Expression evaluation (escaped {{ }})
- [x] Raw expression evaluation ({!! !!})
- [x] Conditional (if/elseif/else)
- [x] Foreach loops
- [x] For loops
- [x] While loops
- [x] JS blocks (@js)

**Tests**: `tests/runtime/runtime.test.ts` (~30 tests)

#### Task 1.2: Expression evaluator
**File**: `src/engines/runtime/expression-evaluator.ts`
```typescript
export class ExpressionEvaluator {
  evaluate(expression: string, context: Record<string, any>): any
  
  // Safety checks
  private isSafeExpression(expr: string): boolean
  private sanitizeExpression(expr: string): string
}
```

**Safety features**:
- ✅ Whitelist safe operations
- ✅ Block dangerous globals (eval, Function constructor misuse)
- ✅ Optional chaining support
- ✅ Nullish coalescing support

**Tests**: `tests/runtime/expression-evaluator.test.ts` (~20 tests)

#### Task 1.3: Context management
**File**: `src/engines/runtime/context.ts`
```typescript
export class RuntimeContext {
  constructor(data: Record<string, any>, parent?: RuntimeContext)
  
  get(key: string): any
  set(key: string, value: any): void
  createChild(data: Record<string, any>): RuntimeContext
  
  // For loop variables, scope management
}
```

### Phase 2: Layout & Include System (Week 3)
**Estimated: 400-500 LOC**

#### Task 2.1: Template composition
**File**: `src/engines/runtime/composer.ts`
```typescript
export class TemplateComposer {
  // Handle @extends, @section, @yield
  async compose(ast: ASTNode[], loader: TemplateLoader): Promise<ASTNode[]>
  
  private extractSections(ast: ASTNode[]): Map<string, ASTNode[]>
  private resolveLayout(layoutName: string): Promise<ASTNode[]>
  private injectSections(layout: ASTNode[], sections: Map): ASTNode[]
}
```

#### Task 2.2: Include processor
**File**: `src/engines/runtime/include-processor.ts`
```typescript
export class IncludeProcessor {
  async processIncludes(ast: ASTNode[], loader: TemplateLoader): Promise<ASTNode[]>
  
  private resolveInclude(path: string, data?: any): Promise<ASTNode[]>
  private mergeIncludeData(parent: Context, include: any): Context
}
```

**Tests**: `tests/runtime/composer.test.ts` (~25 tests)

### Phase 3: New Renderer (Week 4)
**Estimated: 300-400 LOC**

#### Task 3.1: BladeRendererV2
**File**: `src/engines/renderer-v2.ts`
```typescript
export class BladeRendererV2 {
  constructor(options: BladeRenderOptions)
  
  async render(template: string, data: Record<string, any>): Promise<string>
  
  private async loadAndCompile(template: string): Promise<ASTNode[]>
  private createRuntime(data: any): BladeRuntime
  
  clearCache(): void
}
```

**Features**:
- ✅ Use BladeCompilerV2 for parsing
- ✅ Use BladeRuntime for evaluation
- ✅ Template caching (AST cache)
- ✅ Path resolution & security
- ✅ Async include loading

**Tests**: `tests/renderer-v2.test.ts` (~40 tests)

### Phase 4: Migration & Compatibility (Week 5)
**Estimated: 200-300 LOC**

#### Task 4.1: Compatibility layer
**File**: `src/engines/compat.ts`
```typescript
// Helper to migrate from v0.x to v1.x
export function createV1Renderer(options: BladeOptions): BladeRendererV2
export function isV1Compatible(template: string): boolean
```

#### Task 4.2: Update plugin
**File**: `src/plugins/blade.ts`
```typescript
export const bladePlugin = (options: BladeOptions = {}) => {
  // Use BladeRendererV2 by default
  // Fallback to old renderer if specified
  const renderer = options.useV1 !== false 
    ? new BladeRendererV2(...)
    : new BladeRenderer(...);
}
```

#### Task 4.3: Migration guide
**File**: `MIGRATION.md`
- Breaking changes
- API changes
- Performance comparison
- Migration steps

### Phase 5: Performance & Polish (Week 6)
**Estimated: 100-200 LOC + optimization**

#### Task 5.1: Performance optimization
- [ ] Benchmark vs EJS version
- [ ] Optimize hot paths
- [ ] AST caching strategy
- [ ] Expression compilation cache

#### Task 5.2: Security hardening
- [ ] Expression sandbox
- [ ] XSS prevention audit
- [ ] Path traversal tests
- [ ] DoS protection (loop limits)

#### Task 5.3: Documentation
- [ ] Update README with v1.0.0 features
- [ ] API documentation
- [ ] Performance guide
- [ ] Security best practices

---

## 📊 Effort Estimation

| Phase | Tasks | LOC | Tests | Duration |
|-------|-------|-----|-------|----------|
| Phase 1 | Core Runtime | 1000 | 50 | 2 weeks |
| Phase 2 | Layout System | 500 | 25 | 1 week |
| Phase 3 | Renderer V2 | 400 | 40 | 1 week |
| Phase 4 | Migration | 300 | 20 | 1 week |
| Phase 5 | Polish | 200 | 30 | 1 week |
| **Total** | | **2400** | **165** | **6 weeks** |

**With parallelization & buffer: 4-5 weeks**

---

## 🎯 Success Metrics

### Functionality
- ✅ 100% feature parity với EJS version
- ✅ All 116 existing tests pass
- ✅ 165+ new tests for runtime
- ✅ Zero regression bugs

### Performance
- 🎯 Same or better performance vs EJS
- 🎯 <100ms for typical template (vs ~80ms with EJS)
- 🎯 Memory usage <20% increase

### Bundle Size
- 🎯 Remove EJS: -60KB
- 🎯 Add Runtime: +20-30KB
- 🎯 **Net reduction: -30 to -40KB** (54KB → ~20-25KB)

### Developer Experience
- ✅ Better error messages (line/column)
- ✅ TypeScript types for all APIs
- ✅ Migration guide
- ✅ Backward compatibility layer

---

## 🚨 Breaking Changes (v1.0.0)

### Removed
- ❌ EJS dependency
- ❌ `BladeRenderer` (old regex-based)
- ❌ `BladeCompiler` (old regex-based)
- ❌ `cacheDir` option (was already deprecated)

### Renamed
- `BladeRendererV2` → `BladeRenderer`
- `BladeCompilerV2` → `BladeCompiler`

### Changed
- Default renderer now uses AST-based runtime
- Error messages format changed (more detailed)
- Template caching strategy (AST instead of EJS source)

### Added
- ✅ `BladeRuntime` public API
- ✅ `ExpressionEvaluator` for custom expressions
- ✅ `TemplateComposer` for custom layouts
- ✅ Better TypeScript types

---

## 📦 File Structure (v1.0.0)

```
src/
├── engines/
│   ├── compiler.ts              (renamed from compiler-v2)
│   ├── renderer.ts              (renamed from renderer-v2)
│   ├── runtime/
│   │   ├── index.ts
│   │   ├── runtime.ts           [NEW] Core interpreter
│   │   ├── expression-evaluator.ts [NEW]
│   │   ├── context.ts           [NEW]
│   │   ├── composer.ts          [NEW] Layout system
│   │   └── include-processor.ts [NEW]
│   ├── parser/                  (existing, no changes)
│   │   ├── lexer.ts
│   │   ├── parser.ts
│   │   ├── ast.ts
│   │   ├── codegen.ts           (deprecated in v1)
│   │   └── ...
│   └── legacy/                  [NEW] Old implementations
│       ├── compiler-legacy.ts
│       └── renderer-legacy.ts
├── plugins/
│   └── blade.ts                 (updated for v1)
└── index.ts                     (updated exports)

tests/
├── runtime/                     [NEW]
│   ├── runtime.test.ts
│   ├── expression-evaluator.test.ts
│   ├── context.test.ts
│   └── composer.test.ts
├── renderer-v2.test.ts          [NEW]
└── ... (existing tests)
```

---

## 🔄 Migration Path

### For Library Users

#### Before (v0.0.4):
```typescript
import { BladeRenderer } from 'leaf-blade';

const renderer = new BladeRenderer({
  viewsDir: './views',
  cache: true
});
```

#### After (v1.0.0):
```typescript
import { BladeRenderer } from 'leaf-blade';

// Same API, but powered by new runtime!
const renderer = new BladeRenderer({
  viewsDir: './views',
  cache: true
});
```

**No code changes needed!** ✅

### Advanced Usage

```typescript
// Direct runtime access (new in v1.0.0)
import { BladeRuntime, BladeCompiler } from 'leaf-blade';

const compiler = new BladeCompiler({ viewsDir: './views' });
const ast = compiler.parse(template, 'home.blade.html');

const runtime = new BladeRuntime();
const html = await runtime.evaluate(ast, { user: { name: 'John' } });
```

---

## ✅ Checklist Before Release

### Code Complete
- [ ] All phases implemented
- [ ] 165+ tests written and passing
- [ ] All existing 116 tests still passing
- [ ] TypeScript types complete
- [ ] No TODO/FIXME in production code

### Documentation
- [ ] README.md updated
- [ ] CHANGELOG.md for v1.0.0
- [ ] MIGRATION.md written
- [ ] API documentation
- [ ] Code examples updated

### Quality
- [ ] Performance benchmarks run
- [ ] Security audit complete
- [ ] Bundle size verified
- [ ] Memory leak tests pass
- [ ] CI/CD green

### Release
- [ ] Version bumped to 1.0.0
- [ ] Git tagged v1.0.0
- [ ] npm published
- [ ] GitHub release notes
- [ ] Announcement tweet/blog

---

## 🎉 Expected Impact

### For Users
- 🚀 Faster template rendering
- 📦 Smaller bundle size (-40KB)
- 🐛 Better error messages
- 🔒 More secure (no EJS edge cases)
- 💚 TypeScript-first

### For Project
- 🎯 Simpler architecture
- 🧪 More testable
- 🔧 Easier to extend
- 📈 Better performance
- 🌟 Professional 1.0 release

---

**Status**: Ready to implement
**Start Date**: TBD
**Target Release**: Q3 2026
