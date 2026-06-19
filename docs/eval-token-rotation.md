# Eval token rotation

The playlist evaluation token (`PLAYLIST_EVAL_TOKEN`) gates audit/debug generation and CI live regressions.

## Rotate

1. Generate a new secret (32+ random bytes).
2. Update Render environment variable `PLAYLIST_EVAL_TOKEN`.
3. Update GitHub Actions secret `PLAYLIST_EVAL_TOKEN`.
4. Run locally:

```powershell
npm run sync:eval-token
```

Or generate a new token everywhere except Render (then paste + redeploy):

```powershell
npm run rotate:eval-token
```

Or set `PLAYLIST_EVAL_TOKEN` in `.env` and run `npm run verify:eval-token`.

5. Redeploy and confirm:

```bash
npm run smoke:deploy
```

## Schedule

Rotate after any suspected leak, when a contractor leaves, or quarterly.
