# Playground

One small server to verify `drizzle-uncache` end-to-end (Drizzle query cache + Redis).

## Requirements

- Bun
- Redis running (default: `redis://localhost:6379`)
- No DB setup needed (uses Bun's built-in SQLite in-memory via `drizzle-orm/sqlite-proxy` so Drizzle cache hooks run)

## Run

### 1) Start Redis (if you don't have one)

```sh
docker run --rm -p 6379:6379 redis:7-alpine
```

### 2) Run the server

```sh
bun install
bun run playground
```

Server: `http://localhost:3000`

## Endpoints (TTL = 30s)

- `GET /health` — pings Redis
- `GET /keys` — lists cache keys (storage + Redis)
- `GET /users/create` — inserts a random user (triggers invalidation)
- `GET /users` — reads users with `.$withCache()` (30s TTL)
- `GET /clear` — clears the users table and cache keys
