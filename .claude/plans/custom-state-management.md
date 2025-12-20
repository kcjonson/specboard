# COMPLETE - 2025-12-19

# Custom State Management Implementation Plan

## Overview

Port the existing Model/SyncModel pattern from greenhouse-controller to doc-platform, upgraded with:
- TypeScript + native decorators (zero property duplication)
- Preact hooks for component integration

**Reference:** https://github.com/kcjonson/greenhouse-controller/blob/master/packages/web/src/client/Models/Model.js

---

## Phase 1: @doc-platform/fetch

Thin wrapper around native `fetch` for auth middleware and global error handling.

### Files

| File | Purpose |
|------|---------|
| `shared/fetch/src/types.ts` | Interfaces |
| `shared/fetch/src/client.ts` | FetchClient class |
| `shared/fetch/src/index.ts` | Exports |
| `shared/fetch/src/client.test.ts` | Tests |

### API

```typescript
class FetchClient {
  constructor(config?: { baseURL?: string; headers?: Record<string, string> });

  setBaseURL(url: string): void;
  setHeader(key: string, value: string): void;
  removeHeader(key: string): void;

  addRequestInterceptor(fn): () => void;
  addResponseInterceptor(fn): () => void;
  addErrorInterceptor(fn): () => void;

  get<T>(url, config?): Promise<T>;
  post<T>(url, body?, config?): Promise<T>;
  put<T>(url, body?, config?): Promise<T>;
  patch<T>(url, body?, config?): Promise<T>;
  delete<T>(url, config?): Promise<T>;
}

export const fetchClient = new FetchClient();
```

---

## Phase 2: @doc-platform/models

### Usage (with native decorators)

```typescript
class User extends Model {
  @prop id!: number;
  @prop name!: string;
  @prop email!: string | null;
}

const user = new User({ id: 1, name: 'John' });
user.name;                      // 'John' (getter)
user.name = 'Jane';             // setter, emits 'change'
user.set({ name: 'Bob', email: 'bob@test.com' });  // batch, single emit
user.on('change', () => console.log('changed'));
```

### Files

| File | Purpose |
|------|---------|
| `shared/models/src/types.ts` | Interfaces |
| `shared/models/src/prop.ts` | `@prop` decorator |
| `shared/models/src/Model.ts` | Base Model (matches your existing pattern) |
| `shared/models/src/SyncModel.ts` | REST-synced Model |
| `shared/models/src/hooks.ts` | useModel, useSyncModel |
| `shared/models/src/index.ts` | Exports |

### Model API (matching your existing pattern)

```typescript
class Model<T = unknown> {
  readonly $meta: Record<string, unknown>;

  constructor(initialData?: Partial<T>);

  // Set single property or batch
  set(property: string, value: unknown): void;
  set(data: Partial<T>): void;

  // Subscribe to changes
  on(event: 'change', callback: () => void): void;
}

// Properties accessed directly via getters/setters
user.name;          // get
user.name = 'Jane'; // set + emit
```

### SyncModel API

```typescript
class SyncModel<T = unknown> extends Model<T> {
  static url: string;  // '/api/users/:id'

  readonly $meta: {
    working: boolean;
    error: Error | null;
    lastFetched: number | null;
  };

  constructor(params?: Record<string, string | number>, initial?: Partial<T>);

  fetch(): Promise<void>;
  save(): Promise<void>;
  destroy(): Promise<void>;
}
```

### @prop Decorator

```typescript
const PROPERTIES = Symbol('properties');

function prop(_target: undefined, context: ClassFieldDecoratorContext): void {
  context.addInitializer(function(this: Model) {
    const ctor = this.constructor as typeof Model;
    if (!ctor[PROPERTIES]) ctor[PROPERTIES] = new Set();
    ctor[PROPERTIES].add(context.name as string);
  });
}
```

### Preact Hooks

```typescript
// Re-render on model changes
function useModel<T>(model: Model<T>): Model<T>;

// Re-render on SyncModel changes, includes meta
function useSyncModel<T>(model: SyncModel<T>): {
  model: SyncModel<T>;
  meta: ModelMeta;
  refetch: () => Promise<void>;
};
```

---

## Implementation Order

1. **Fetch** - types, client, tests
2. **@prop decorator** - property registration via native decorators
3. **Model** - port from greenhouse-controller, add TypeScript
4. **SyncModel** - extend Model with fetch/save/destroy
5. **Hooks** - useModel, useSyncModel
6. **Tests**

---

## Example

```typescript
// Define
class User extends SyncModel {
  static url = '/api/users/:id';

  @prop id!: number;
  @prop name!: string;
  @prop email!: string | null;
}

// Use
const user = new User({ id: 123 });  // fetches /api/users/123

user.on('change', () => {
  console.log(user.name, user.$meta.working);
});

user.name = 'New Name';
await user.save();
```

---

## Critical Files

| File | Action |
|------|--------|
| `shared/fetch/src/index.ts` | Replace placeholder |
| `shared/models/src/index.ts` | Replace placeholder |
| `shared/models/package.json` | Add dependencies |
