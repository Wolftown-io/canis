#!/usr/bin/env bash
# Daily PostgreSQL backup for Kaiku
#
# Usage:
#   ./infra/scripts/backup.sh
#
# Crontab (daily at 03:00):
#   0 3 * * * /opt/kaiku/infra/scripts/backup.sh >> /var/log/kaiku-backup.log 2>&1
#
# Environment variables (all optional, defaults shown):
#   BACKUP_DIR=/var/lib/kaiku/backups
#   POSTGRES_CONTAINER=canis-postgres
#   POSTGRES_USER=voicechat
#   POSTGRES_DB=voicechat
#   RETENTION_DAYS=7

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/lib/kaiku/backups}"
CONTAINER="${POSTGRES_CONTAINER:-canis-postgres}"
DB_USER="${POSTGRES_USER:-voicechat}"
DB_NAME="${POSTGRES_DB:-voicechat}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/kaiku-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# Dump and compress
docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Verify
if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date)] Backup complete: $BACKUP_FILE ($SIZE)"
else
    echo "[$(date)] ERROR: Backup file is empty!" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Prune old backups
find "$BACKUP_DIR" -name "kaiku-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "kaiku-*.sql.gz" | wc -l)
echo "[$(date)] Retained $REMAINING backup(s)"
