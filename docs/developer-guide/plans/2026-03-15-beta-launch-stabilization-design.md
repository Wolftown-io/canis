# Beta Launch Stabilization — Design

**Date:** 2026-03-15

**Goal:** Add a complete monitoring stack to the production Docker Compose, enable built-in OTel telemetry, provision Grafana dashboards, and add automated database backups — enabling a single-VPS beta deployment with full observability from day one.

## Deployment Target

Single VPS (e.g. Hetzner/Contabo) running everything via Docker Compose. Monitoring services are localhost-only, accessible through Netbird VPN. No public exposure of Grafana/Prometheus/Tempo/Loki.

## Architecture

```
Internet
  │
  ├─ TCP 80/443 ──► Traefik (Let's Encrypt TLS)
  │                    └─► vc-server :8080
  │
  └─ UDP 10000-10100 ──► vc-server (WebRTC RTP)

Netbird VPN (localhost only)
  │
  ├─ :3000 ──► Grafana (dashboards, logs, traces)
  ├─ :9090 ──► Prometheus (metrics)
  ├─ :3200 ──► Tempo (traces)
  └─ :3100 ──► Loki (logs)

Internal (not exposed)
  │
  ├─ vc-server ──OTLP gRPC──► OTel Collector :4317
  │                              ├──► Tempo
  │                              ├──► Prometheus (:8889 spanmetrics)
  │                              └──► Loki
  │
  ├─ PostgreSQL :5432
  └─ Valkey :6379
```

## Changes Required

### 1. Production Compose — Add Monitoring Services

Add to `infra/compose/docker-compose.yml` under a `monitoring` profile (already partially referenced):

| Service | Image | Ports (localhost) | Volumes |
|---------|-------|-------------------|---------|
| otel-collector | `otel/opentelemetry-collector-contrib:0.96.0` | 127.0.0.1:4317 (gRPC), 127.0.0.1:4318 (HTTP) | `../monitoring/otel-collector.yaml` |
| prometheus | `prom/prometheus:v2.51.0` | 127.0.0.1:9090 | `../monitoring/prometheus.yaml`, `prometheus-data` |
| tempo | `grafana/tempo:2.4.0` | 127.0.0.1:3200 | `../monitoring/tempo.yaml`, `tempo-data` |
| loki | `grafana/loki:2.9.0` | 127.0.0.1:3100 | `../monitoring/loki.yaml`, `loki-data` |
| grafana | `grafana/grafana:10.4.0` | 127.0.0.1:3000 | `../monitoring/grafana/provisioning`, `grafana-data` |

All services in `monitoring` profile so they're opt-in: `docker compose --profile monitoring up -d`.

### 2. Monitoring Config Files

**Already exist (verify/update):**
- `infra/monitoring/otel-collector.yaml` — receivers, processors, exporters
- `infra/monitoring/prometheus.yaml` — scrape configs

**Need to create:**
- `infra/monitoring/tempo.yaml` — Tempo config (local storage, 30-day retention)
- `infra/monitoring/loki.yaml` — Loki config (local storage, 14-day retention)
- `infra/monitoring/grafana/provisioning/datasources/datasources.yaml` — auto-provision Prometheus, Tempo, Loki
- `infra/monitoring/grafana/provisioning/dashboards/dashboards.yaml` — dashboard provider config
- `infra/monitoring/grafana/provisioning/dashboards/kaiku-overview.json` — pre-built overview dashboard

### 3. Grafana Dashboard — "Kaiku Overview"

Panels:
- Request rate (req/s) from spanmetrics
- Error rate (%) from spanmetrics
- P95 latency (ms) from spanmetrics
- Active WebSocket connections (gauge)
- Voice sessions (gauge)
- Recent logs (Loki log panel)
- Trace search (Tempo)

### 4. Server Config — Enable OTel

Update `.env.example` and production compose environment:
```
OBSERVABILITY_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=vc-server
OTEL_TRACES_SAMPLER_ARG=1.0  # 100% sampling for beta (low traffic)
```

### 5. Database Backup Script

Create `infra/scripts/backup.sh`:
- pg_dump to `/backups/kaiku-YYYY-MM-DD.sql.gz`
- Retain last 7 days
- Run via host crontab: `0 3 * * * /path/to/backup.sh`

Add backup volume to compose.

### 6. .env.example Update

Add monitoring-related variables with sensible beta defaults. Document which are required vs optional.

## What We're NOT Doing (YAGNI)

- No Sentry integration (Grafana + Loki covers errors)
- No Kubernetes probes (compose only)
- No Prometheus alerting rules (watch Grafana manually for beta)
- No object storage backup (files replaceable for beta)
- No custom app metrics endpoint (spanmetrics covers RED)
- No Grafana SSO/OIDC (local admin auth sufficient)

## Success Criteria

1. `docker compose --profile monitoring up -d` starts all monitoring services
2. Grafana at `localhost:3000` shows Kaiku Overview dashboard with live data
3. Server logs appear in Loki, traces in Tempo, RED metrics in Prometheus
4. Database backups run daily, 7-day retention
5. Zero public exposure of monitoring services
