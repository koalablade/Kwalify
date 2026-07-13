#!/usr/bin/env bash
#
# Timestamped PostgreSQL backup for Kwalify (self-hosted).
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/kwalify ./scripts/backup-db.sh
#
# Env:
#   DATABASE_URL   (required) connection string
#   BACKUP_DIR     (optional) output dir, default ./backups
#   BACKUP_RETAIN  (optional) keep the most recent N dumps, default 14 (0 = keep all)
#
# Produces: $BACKUP_DIR/kwalify-YYYYMMDD-HHMMSS.dump  (pg_dump custom format, compressed)
# Exits non-zero and prints to stderr on any failure.

set -euo pipefail

fail() { echo "[backup-db] ERROR: $*" >&2; exit 1; }

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found on PATH (install postgresql-client)."
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-14}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTFILE="${BACKUP_DIR}/kwalify-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR" || fail "could not create backup dir '$BACKUP_DIR'."

echo "[backup-db] dumping to ${OUTFILE} ..."
# -Fc: custom (compressed, restorable with pg_restore). --no-owner for portability.
if ! pg_dump --format=custom --no-owner --file="$OUTFILE" "$DATABASE_URL"; then
  rm -f "$OUTFILE" 2>/dev/null || true
  fail "pg_dump failed; partial file removed."
fi

# Sanity: dump must be non-empty.
if [ ! -s "$OUTFILE" ]; then
  rm -f "$OUTFILE" 2>/dev/null || true
  fail "backup file is empty; removed."
fi

SIZE="$(du -h "$OUTFILE" | cut -f1)"
echo "[backup-db] OK: ${OUTFILE} (${SIZE})"

# Retention: delete all but the newest N dumps.
if [ "$BACKUP_RETAIN" -gt 0 ] 2>/dev/null; then
  mapfile -t OLD < <(ls -1t "${BACKUP_DIR}"/kwalify-*.dump 2>/dev/null | tail -n +"$((BACKUP_RETAIN + 1))")
  for f in "${OLD[@]:-}"; do
    [ -n "$f" ] || continue
    echo "[backup-db] pruning old backup: $f"
    rm -f "$f"
  done
fi

cat <<EOF
[backup-db] Restore this backup with (stop the app first):
  pg_restore --clean --if-exists --no-owner --dbname "\$DATABASE_URL" "${OUTFILE}"
EOF
