# Vercel API Routes - Import Resolution Problem

## Summary

When deploying to Vercel, the API routes in `/api/` cannot import from `/src/services/server/SupabaseManager.ts` because Vercel's TypeScript compiler only sees `api/` and `node_modules/`, not the `src/` directory.

## Project Structure

```
/
├── api/                          # Vercel serverless functions
│   ├── sync/
│   │   ├── push.ts              # imports from ../../../src/services/server/SupabaseManager.js
│   │   └── status.ts            # imports from ../../../src/services/server/SupabaseManager.js
│   ├── agents/
│   │   ├── create.ts
│   │   ├── index.ts
│   │   └── revoke.ts
│   ├── auth.ts                 # imports from ../src/services/server/SupabaseManager.js
│   ├── db-check.ts
│   ├── health.ts
│   ├── search.ts               # imports from ../../src/services/server/SupabaseManager.js
│   └── timeline.ts
├── src/
│   └── services/
│       └── server/
│           ├── SupabaseManager.ts    # Uses @supabase/supabase-js
│           ├── PostgresManager.ts    # Uses postgres.js
│           └── migrations/
│               └── 001-initial-schema.sql
└── supabase/
    └── migrations/
        ├── 20260414180909_initial-schema.sql
        └── 20260414182000_rls-policies.sql
```

## The Import Chain

```
api/sync/push.ts
├── imports: '../../../src/services/server/SupabaseManager.js'
│   └── imports: '@supabase/supabase-js' (from node_modules ✓)
└── imports: '../src/services/server/auth/key-generator.js'
    └── imports: 'crypto' (Node built-in ✓)
```

## Why It Fails

Vercel compiles each API file independently. When TypeScript tries to resolve `../../../src/services/server/SupabaseManager.js`, it can't find it because:

1. The project's `tsconfig.json` has `rootDir: "./src"` and `include: ["src/**/*"]`
2. Vercel's API compiler doesn't use this tsconfig - it has its own
3. The relative path `../../../src/` goes outside the `api/` directory which isn't in scope

## Files That Need Changes

### 1. `/api/sync/push.ts`
```typescript
// CURRENT (broken):
import { initSupabase } from '../../../src/services/server/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

// NEEDED: Inline SupabaseManager directly in this file
// OR: Move SupabaseManager to api/ directory
```

### 2. `/api/sync/status.ts`
Same issue - imports from `../../../src/services/server/SupabaseManager.js`

### 3. `/api/search.ts`
Imports from `../../src/services/server/SupabaseManager.js`

### 4. `/api/timeline.ts`
Imports from `../src/services/server/SupabaseManager.js`

### 5. `/api/auth.ts`
Imports from `../src/services/server/SupabaseManager.js`

### 6. `/api/db-check.ts`
Imports from `../src/services/server/SupabaseManager.js`

### 7. `/api/agents/index.ts`
Imports from `../../src/services/server/SupabaseManager.js`

### 8. `/api/agents/create.ts`
Imports from `../../src/services/server/SupabaseManager.js`

### 9. `/api/agents/revoke.ts`
Imports from `../../src/services/server/SupabaseManager.js`

## Solutions

### Option A: Inline SupabaseManager in Each API File (Recommended)

Copy the entire `SupabaseManager` class into each API file. Each serverless function becomes self-contained.

**Pros:**
- No import resolution issues
- Each function deploys independently
- Works with Vercel's compilation model

**Cons:**
- Code duplication (~300 lines repeated 9 times)
- Changes to SupabaseManager must be applied to all files

### Option B: Create Shared API Utils in `/api/` Directory

```
api/
├── lib/
│   ├── SupabaseManager.ts      # Copy of SupabaseManager
│   └── auth.ts                 # Shared auth helper
├── sync/
│   ├── push.ts
│   └── status.ts
└── ...
```

Move `SupabaseManager` to `api/lib/SupabaseManager.ts` and import from there.

**Pros:**
- Single source of truth for shared code
- Vercel can resolve imports within `api/`

**Cons:**
- Need to maintain two copies or refactor build to copy files

### Option C: Use @vercel/build-output

Configure Vercel to use a custom build that compiles `src/` first, then deploys API.

### Option D: Use Edge Functions with Different Setup

Use `@vercel/edge` or a different deployment structure.

## What Was Tried (Failed)

1. **Adding `api/**/*` to tsconfig.json include**
   - Result: `rootDir: "./src"` conflicts - `api/` files not under rootDir
   - Fixing by removing rootDir surfaced 100+ pre-existing type errors in unrelated files

2. **Moving API to `src/api/` with `apiDirectory` config**
   - `apiDirectory` is not a valid vercel.json option

3. **Custom buildCommand compiling src/ separately**
   - TypeScript errors from pre-existing codebase (bun:sqlite, execSync options, etc.)
   - These don't fail local build but fail Vercel's stricter checks

4. **Copying files between `src/api/` and `api/` with sed fixes**
   - TypeScript still can't resolve cross-directory imports in Vercel context

## Environment Variables Needed

These are set in Vercel dashboard, not in code:

```
SUPABASE_URL=https://oqbnrnhnzugrqypkpuce.supabase.co
SUPABASE_ANON_KEY=<from Supabase dashboard>
```

## Alternative: Deploy Without the API Routes

The worker service and plugin build successfully. The API routes are for the multi-agent sync server feature only. If the priority is deploying the core product, skip the API routes for now.

## Recommended Fix

**Inline SupabaseManager in each API file.** It's ~300 lines and each API file is small. This is the most reliable approach for Vercel serverless.

Steps:
1. Copy `SupabaseManager` class code into each of the 9 API files
2. Remove the import line for SupabaseManager
3. Deploy

This avoids all cross-directory import resolution issues.
