# Beta Launch Stabilization Implementation Plan

**Goal:** Add Grafana, Prometheus, Tempo, and Loki to the production compose file (localhost-only), enable OTel telemetry, provision a Kaiku overview dashboard, and add automated database backups.

**Architecture:** Extend the existing `monitoring` profile in `infra/compose/docker-compose.yml` with downstream services. All monitoring binds to 127.0.0.1 (Netbird access only). Server already has OTel SDK — just needs `OBSERVABILITY_ENABLED=true`.

**Tech Stack:** Docker Compose, Grafana 10.4, Prometheus 2.51, Grafana Tempo 2.4, Grafana Loki 2.9, OTel Collector 0.117

**Design doc:** `docs/developer-guide/plans/2026-03-15-beta-launch-stabilization-design.md`

---

### Task 1: Create Tempo and Loki config files

**Files:**
- Create: `infra/monitoring/tempo.yaml`
- Create: `infra/monitoring/loki.yaml`

**Step 1: Create Tempo config**

Create `infra/monitoring/tempo.yaml`:

```yaml
# Grafana Tempo — distributed trace storage for Kaiku
# Receives traces from OTel Collector via OTLP gRPC.

server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: "0.0.0.0:4317"

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces
    wal:
      path: /var/tempo/wal

compactor:
  compaction:
    block_retention: 720h  # 30 days

metrics_generator:
  storage:
    path: /var/tempo/generator/wal
```

**Step 2: Create Loki config**

Create `infra/monitoring/loki.yaml`:

```yaml
# Grafana Loki — log aggregation for Kaiku
# Receives logs from OTel Collector via push API.

auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

limits_config:
  retention_period: 336h  # 14 days
  reject_old_samples: true
  reject_old_samples_max_age: 168h

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
```

**Step 3: Commit**

```
feat(infra): add Tempo and Loki configs for monitoring stack
```

---

### Task 2: Create Grafana provisioning files

**Files:**
- Create: `infra/monitoring/grafana/provisioning/datasources/datasources.yaml`
- Create: `infra/monitoring/grafana/provisioning/dashboards/dashboards.yaml`

**Step 1: Create datasources provisioning**

```yaml
# Auto-provisioned datasources for Grafana
# Connects to Prometheus (metrics), Tempo (traces), and Loki (logs).

apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false

  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    editable: false
    jsonData:
      tracesToMetrics:
        datasourceUid: prometheus
      nodeGraph:
        enabled: true
      serviceMap:
        datasourceUid: prometheus

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: false
    jsonData:
      derivedFields:
        - datasourceUid: tempo
          matcherRegex: "trace_id=(\\w+)"
          name: TraceID
          url: "$${__value.raw}"
```

**Step 2: Create dashboard provider config**

```yaml
# Dashboard provisioning — auto-loads JSON dashboards from /var/lib/grafana/dashboards

apiVersion: 1

providers:
  - name: Kaiku
    orgId: 1
    folder: Kaiku
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

**Step 3: Commit**

```
feat(infra): add Grafana datasource and dashboard provisioning
```

---

### Task 3: Create Kaiku Overview dashboard

**Files:**
- Create: `infra/monitoring/grafana/provisioning/dashboards/kaiku-overview.json`

**Step 1: Create the dashboard JSON**

Create a Grafana dashboard JSON with these panels:
- **Row 1 (RED metrics):** Request Rate (req/s), Error Rate (%), P95 Latency (ms) — all from `traces_span_metrics_*` via Prometheus
- **Row 2 (System):** Active connections gauge, Voice sessions gauge
- **Row 3 (Logs):** Loki log stream panel with severity filter

The dashboard should use the provisioned datasource names (Prometheus, Tempo, Loki).

Use `traces_span_metrics_calls_total` for request rate, `traces_span_metrics_duration_milliseconds_bucket` for latency histograms.

**Step 2: Commit**

```
feat(infra): add Kaiku Overview Grafana dashboard
```

---

### Task 4: Add monitoring services to production compose

**Files:**
- Modify: `infra/compose/docker-compose.yml`

**Step 1: Bind OTel collector ports to localhost**

Change the existing `otel-collector` ports from public to localhost-only:

```yaml
    ports:
      - "127.0.0.1:4317:4317"
      - "127.0.0.1:4318:4318"
      - "127.0.0.1:8889:8889"
```

**Step 2: Add Prometheus service**

Add after `otel-collector`:

```yaml
  prometheus:
    image: prom/prometheus:v2.51.0
    container_name: canis-prometheus
    restart: unless-stopped
    profiles: ["monitoring"]
    command:
      - "--config.file=/etc/prometheus/prometheus.yaml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=90d"
      - "--web.enable-lifecycle"
    volumes:
      - ../monitoring/prometheus.yaml:/etc/prometheus/prometheus.yaml:ro
      - ../monitoring/alerts:/etc/prometheus/alerts:ro
      - prometheus_data:/prometheus
    ports:
      - "127.0.0.1:9090:9090"
    networks:
      - voicechat
```

**Step 3: Add Tempo service**

```yaml
  tempo:
    image: grafana/tempo:2.4.0
    container_name: canis-tempo
    restart: unless-stopped
    profiles: ["monitoring"]
    command: ["-config.file=/etc/tempo/tempo.yaml"]
    volumes:
      - ../monitoring/tempo.yaml:/etc/tempo/tempo.yaml:ro
      - tempo_data:/var/tempo
    ports:
      - "127.0.0.1:3200:3200"
    networks:
      - voicechat
```

**Step 4: Add Loki service**

```yaml
  loki:
    image: grafana/loki:2.9.0
    container_name: canis-loki
    restart: unless-stopped
    profiles: ["monitoring"]
    command: ["-config.file=/etc/loki/loki.yaml"]
    volumes:
      - ../monitoring/loki.yaml:/etc/loki/loki.yaml:ro
      - loki_data:/loki
    ports:
      - "127.0.0.1:3100:3100"
    networks:
      - voicechat
```

**Step 5: Add Grafana service**

```yaml
  grafana:
    image: grafana/grafana:10.4.0
    container_name: canis-grafana
    restart: unless-stopped
    profiles: ["monitoring"]
    environment:
      - GF_SECURITY_ADMIN_USER=${GRAFANA_ADMIN_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_SERVER_ROOT_URL=http://localhost:3000
    volumes:
      - ../monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ../monitoring/grafana/provisioning/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana
    ports:
      - "127.0.0.1:3000:3000"
    networks:
      - voicechat
    depends_on:
      - prometheus
      - tempo
      - loki
```

**Step 6: Add volumes**

Add to the `volumes:` section:

```yaml
  prometheus_data:
  tempo_data:
  loki_data:
  grafana_data:
  backups:
```

**Step 7: Commit**

```
feat(infra): add Grafana, Prometheus, Tempo, Loki to compose
```

---

### Task 5: Enable OTel in server config and .env.example

**Files:**
- Modify: `infra/compose/docker-compose.yml` (server environment)
- Modify: `.env.example`

**Step 1: Add OTel env vars to server service**

Add to the `server` service `environment` list in compose:

```yaml
      # Observability (enable with --profile monitoring)
      - OBSERVABILITY_ENABLED=${OBSERVABILITY_ENABLED:-false}
      - OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-http://otel-collector:4317}
      - OTEL_SERVICE_NAME=vc-server
      - OTEL_TRACES_SAMPLER_ARG=${OTEL_TRACES_SAMPLER_ARG:-1.0}
      - RUST_LOG=${RUST_LOG:-vc_server=info}
```

**Step 2: Add monitoring section to .env.example**

Add to `.env.example`:

```bash
# =============================================================================
# Observability (enable with: docker compose --profile monitoring up -d)
# =============================================================================

# Enable OpenTelemetry telemetry export
OBSERVABILITY_ENABLED=true

# Trace sampling ratio (1.0 = 100% for beta, 0.1 = 10% for production)
OTEL_TRACES_SAMPLER_ARG=1.0

# Log level
RUST_LOG=vc_server=info

# Grafana admin credentials (change in production!)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=changeme_grafana_password
```

**Step 3: Commit**

```
feat(infra): enable OTel in server config and .env.example
```

---

### Task 6: Create database backup script

**Files:**
- Create: `infra/scripts/backup.sh`

**Step 1: Create the backup script**

```bash
#!/usr/bin/env bash
# Daily PostgreSQL backup for Kaiku
# Usage: Add to crontab: 0 3 * * * /path/to/infra/scripts/backup.sh
#
# Retention: 7 days (older backups auto-deleted)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/lib/kaiku/backups}"
CONTAINER="${POSTGRES_CONTAINER:-canis-postgres}"
DB_USER="${POSTGRES_USER:-voicechat}"
DB_NAME="${POSTGRES_DB:-voicechat}"
RETENTION_DAYS=7
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
find "$BACKUP_DIR" -name "kaiku-*.sql.gz" -mtime +$RETENTION_DAYS -delete
REMAINING=$(find "$BACKUP_DIR" -name "kaiku-*.sql.gz" | wc -l)
echo "[$(date)] Retained $REMAINING backup(s)"
```

**Step 2: Make executable**

```bash
chmod +x infra/scripts/backup.sh
```

**Step 3: Commit**

```
feat(infra): add daily database backup script with 7-day retention
```

---

### Task 7: Update deployment docs and CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/admin-guide/ops/deployment.md`

**Step 1: Add CHANGELOG entry**

Under `[Unreleased] → ### Added`:

```
- Monitoring stack — Grafana, Prometheus, Tempo, and Loki available via `--profile monitoring`, with auto-provisioned datasources and Kaiku Overview dashboard (localhost-only, access via VPN)
- Database backup script — daily pg_dump with 7-day retention (`infra/scripts/backup.sh`)
- OpenTelemetry telemetry — traces, metrics, and logs exported to monitoring stack when `OBSERVABILITY_ENABLED=true`
```

**Step 2: Add monitoring section to deployment docs**

Add a "Monitoring" section to `docs/admin-guide/ops/deployment.md` explaining:
- How to start with monitoring: `docker compose --profile monitoring up -d`
- How to access Grafana (localhost:3000 via VPN)
- How to set up the backup cron job
- Default Grafana credentials

**Step 3: Commit**

```
docs(infra): update deployment docs and CHANGELOG for beta
```

---

### Task 8: Final verification

**Step 1: Validate compose syntax**

```bash
cd infra/compose && docker compose --profile monitoring config --quiet
```

Expected: no errors.

**Step 2: Verify all config files are valid YAML**

```bash
python3 -c "
import yaml, sys
for f in ['infra/monitoring/tempo.yaml', 'infra/monitoring/loki.yaml',
          'infra/monitoring/grafana/provisioning/datasources/datasources.yaml',
          'infra/monitoring/grafana/provisioning/dashboards/dashboards.yaml']:
    try:
        yaml.safe_load(open(f))
        print(f'OK: {f}')
    except Exception as e:
        print(f'FAIL: {f}: {e}')
        sys.exit(1)
"
```

**Step 3: Verify .env.example has all referenced variables**

```bash
grep -oP '\$\{(\w+)' infra/compose/docker-compose.yml | sort -u | sed 's/\${//' | while read var; do
  grep -q "^${var}=" .env.example || echo "MISSING: $var"
done
```
