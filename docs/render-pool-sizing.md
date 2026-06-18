# Render PostgreSQL pool sizing

Set on Render via environment variables:

| Variable | Starter | Standard | Notes |
|----------|---------|----------|-------|
| `DB_POOL_MAX` | 8 | 15 | Must stay below Postgres `max_connections` minus admin overhead |
| `DB_POOL_IDLE_MS` | 30000 | 30000 | Close idle clients after 30s |
| `DB_POOL_CONNECT_MS` | 12000 | 12000 | Fail fast when pool saturated |
| `DB_POOL_WAITING_WARN_THRESHOLD` | 20 | 30 | Log when queue depth exceeds threshold |

Free tier: use `DB_POOL_MAX=5` if seeing `SERVER_BUSY` or pool queue warnings during concurrent generates.
