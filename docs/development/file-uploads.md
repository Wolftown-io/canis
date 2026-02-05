# File Uploads Development Guide

## Overview

File uploads in VoiceChat require S3-compatible storage. For local development, we use MinIO, an open-source S3-compatible storage server.

## Setup

### 1. Start MinIO

MinIO is included in the development Docker Compose setup but requires the `storage` profile:

```bash
# Start all services including MinIO
docker compose -f docker-compose.dev.yml --profile storage up -d

# Or start only core services + storage
docker compose -f docker-compose.dev.yml --profile storage up -d
```

### 2. Initialize the MinIO Bucket

After starting MinIO for the first time, initialize the bucket:

```bash
# Using Docker (recommended - no local mc client needed)
docker exec canis-dev-minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec canis-dev-minio mc mb --ignore-existing local/voicechat
docker exec canis-dev-minio mc anonymous set none local/voicechat

# Or use the provided script (requires mc client installed locally)
./scripts/init-minio.sh
```

### 3. Configure Environment Variables

Ensure your `.env` file contains the MinIO configuration:

```bash
# S3 Configuration (MinIO for development)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=voicechat
S3_PRESIGN_EXPIRY=3600

# AWS Credentials (MinIO defaults)
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

### 4. Start/Restart the Server

The server will automatically detect and connect to MinIO on startup:

```bash
cd server
cargo run
```

You should see a log message:
```
INFO S3 storage connected bucket=voicechat
```

## Testing File Uploads

### Via API

```bash
# Create a test channel first (requires auth token)
TOKEN="your_jwt_token"
CHANNEL_ID="your_channel_id"

# Upload a file with a message
curl -X POST "http://localhost:8080/api/messages/channel/$CHANNEL_ID/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/file.png" \
  -F "content=Check out this image!"
```

### Via Client

1. Start the desktop client: `cd client && bun run tauri dev`
2. Navigate to any text channel
3. Click the "+" button next to the message input
4. Select a file to upload
5. Send the message

## MinIO Console

Access the MinIO web console to view uploaded files:

- **URL**: http://localhost:9001
- **Username**: minioadmin
- **Password**: minioadmin

## Troubleshooting

### "File uploads are not configured" Error

**Cause**: Server couldn't connect to S3/MinIO.

**Solutions**:
1. Check MinIO is running: `docker ps | grep minio`
2. Verify environment variables in `.env`
3. Check server logs for S3 connection errors
4. Restart the server after starting MinIO

### Bucket Access Denied

**Cause**: Bucket doesn't exist or has wrong permissions.

**Solution**: Run the initialization script again:
```bash
docker exec canis-dev-minio mc mb --ignore-existing local/voicechat
docker exec canis-dev-minio mc anonymous set none local/voicechat
```

### Connection Timeout

**Cause**: MinIO not responding or wrong endpoint.

**Solution**:
1. Test MinIO health: `curl http://localhost:9000/minio/health/live`
2. Check `S3_ENDPOINT` in `.env` matches MinIO port (9000, not 9001)
3. Restart MinIO: `docker restart canis-dev-minio`

## File Upload Limits

Default limits (configured via environment variables):

- **Attachments**: 50MB (`MAX_UPLOAD_SIZE`)
- **Avatars**: 5MB (`MAX_AVATAR_SIZE`)
- **Emojis**: 256KB (`MAX_EMOJI_SIZE`)

To change limits, update your `.env`:

```bash
MAX_UPLOAD_SIZE=104857600        # 100MB for attachments
MAX_AVATAR_SIZE=10485760          # 10MB for avatars
MAX_EMOJI_SIZE=524288             # 512KB for emojis
```

**Important**: `MAX_UPLOAD_SIZE` must be ≥ all other limits.

## Production Deployment

For production, use real S3 or another S3-compatible service:

### AWS S3

```bash
S3_ENDPOINT=                      # Leave empty for AWS S3
S3_BUCKET=your-production-bucket
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

### Cloudflare R2

```bash
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=your-r2-bucket
AWS_ACCESS_KEY_ID=<r2-access-key>
AWS_SECRET_ACCESS_KEY=<r2-secret-key>
```

### Backblaze B2

```bash
S3_ENDPOINT=https://s3.us-west-002.backblazeb2.com
S3_BUCKET=your-b2-bucket
AWS_ACCESS_KEY_ID=<b2-key-id>
AWS_SECRET_ACCESS_KEY=<b2-application-key>
```

## Security Notes

- MinIO credentials are for **development only**
- Never use `minioadmin` in production
- Always use HTTPS (`https://`) endpoints in production
- Set restrictive bucket policies (private buckets)
- Use presigned URLs for temporary access (default: 1 hour)
- Rotate AWS credentials regularly in production

## Architecture

File upload flow:

1. **Client** sends multipart form-data with file + optional text
2. **Server** validates file size and MIME type
3. **Server** uploads to S3 with key: `attachments/{channel_id}/{message_id}/{file_id}.{ext}`
4. **Server** stores metadata in `message_attachments` table
5. **Server** broadcasts message with attachment info via WebSocket
6. **Client** requests file via `/api/messages/attachments/{id}/download`
7. **Server** streams file from S3 with presigned URL or direct proxy

All file downloads require authentication (JWT token in header or query parameter).
