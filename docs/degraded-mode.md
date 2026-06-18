# Degraded mode (user-facing)

When the server is under heavy load, Kwalify may enter **degraded** or **critical** health states.

## What changes

- Retrieval may use a smaller candidate slice for speed.
- Generation may queue (`SERVER_BUSY`) — wait and retry.
- Trust chips may show **Recovery Assisted** or **Best Available Match**.

## What users should do

- Wait 30–60 seconds and try again during spikes.
- Use **Balanced** mode for faster runs on large libraries.
- Avoid rapid repeat generates (rate limit: 5 per minute).
