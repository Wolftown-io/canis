//! Webhook Delivery Worker
//!
//! Background worker that processes webhook deliveries from a Redis queue
//! with exponential backoff retries and dead-letter handling.

use std::time::Duration;

use fred::interfaces::ListInterface;
use fred::prelude::*;
use sqlx::PgPool;
use tracing::{error, info, warn};

use super::queries;
use super::signing;
use super::types::WebhookDeliveryItem;

/// Redis key for the webhook delivery queue.
const DELIVERY_QUEUE_KEY: &str = "webhook:delivery:queue";

/// Maximum retry attempts before dead-lettering.
const MAX_ATTEMPTS: u32 = 5;

/// Retry delays (exponential backoff).
const RETRY_DELAYS: [Duration; 5] = [
    Duration::from_secs(5),
    Duration::from_secs(30),
    Duration::from_secs(120),
    Duration::from_secs(600),
    Duration::from_secs(1800),
];

/// Enqueue a delivery item for processing.
pub async fn enqueue(redis: &Client, item: &WebhookDeliveryItem) -> Result<(), Error> {
    let payload = serde_json::to_string(item)
        .map_err(|e| Error::new(ErrorKind::Parse, format!("JSON serialize error: {e}")))?;

    redis.lpush::<(), _, _>(DELIVERY_QUEUE_KEY, payload).await?;
    Ok(())
}

/// Spawn the background delivery worker.
pub async fn spawn_delivery_worker(db: PgPool, redis: Client, http_client: reqwest::Client) {
    info!("Webhook delivery worker started");

    loop {
        // BRPOP with 5-second timeout
        let result: Result<Option<(String, String)>, _> =
            redis.brpop(DELIVERY_QUEUE_KEY, 5.0).await;

        let payload_str = match result {
            Ok(Some((_key, value))) => value,
            Ok(None) => continue, // Timeout, no items
            Err(e) => {
                error!("Failed to BRPOP from delivery queue: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        let item: WebhookDeliveryItem = match serde_json::from_str(&payload_str) {
            Ok(item) => item,
            Err(e) => {
                error!("Failed to deserialize delivery item: {}", e);
                continue;
            }
        };

        let db = db.clone();
        let redis = redis.clone();
        let client = http_client.clone();

        // Process delivery in a separate task to not block the worker loop
        tokio::spawn(async move {
            process_delivery(&db, &redis, &client, item).await;
        });
    }
}

/// Process a single webhook delivery.
async fn process_delivery(
    db: &PgPool,
    redis: &Client,
    client: &reqwest::Client,
    item: WebhookDeliveryItem,
) {
    // Build CloudEvents 1.0 envelope
    let envelope = serde_json::json!({
        "specversion": "1.0",
        "type": item.event_type.as_str(),
        "source": "canis",
        "id": item.event_id.to_string(),
        "time": item.event_time.to_rfc3339(),
        "data": item.payload,
    });

    let payload_bytes = match serde_json::to_vec(&envelope) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to serialize webhook envelope: {}", e);
            return;
        }
    };

    let signature = signing::sign_payload(&item.signing_secret, &payload_bytes);
    let timestamp = chrono::Utc::now().timestamp().to_string();

    let start = std::time::Instant::now();
    let result = client
        .post(&item.url)
        .header("Content-Type", "application/json")
        .header("X-Webhook-Signature", format!("sha256={signature}"))
        .header("X-Webhook-Event", item.event_type.as_str())
        .header("X-Webhook-ID", item.event_id.to_string())
        .header("X-Webhook-Timestamp", &timestamp)
        .body(payload_bytes)
        .send()
        .await;
    let latency_ms = start.elapsed().as_millis() as i32;

    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let success = resp.status().is_success();

            // Log delivery result
            let error_msg = if !success {
                Some(format!("HTTP {status}"))
            } else {
                None
            };
            if let Err(e) = queries::log_delivery(
                db,
                item.webhook_id,
                item.event_type,
                item.event_id,
                Some(status as i16),
                success,
                item.attempt as i32,
                error_msg.as_deref(),
                Some(latency_ms),
            )
            .await
            {
                error!("Failed to log delivery: {}", e);
            }

            if !success {
                handle_retry(db, redis, item, &format!("HTTP {status}")).await;
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            warn!(
                webhook_id = %item.webhook_id,
                attempt = item.attempt,
                error = %error_msg,
                "Webhook delivery failed"
            );

            // Log failure
            if let Err(log_err) = queries::log_delivery(
                db,
                item.webhook_id,
                item.event_type,
                item.event_id,
                None,
                false,
                item.attempt as i32,
                Some(&error_msg),
                Some(latency_ms),
            )
            .await
            {
                error!("Failed to log delivery failure: {}", log_err);
            }

            handle_retry(db, redis, item, &error_msg).await;
        }
    }
}

/// Handle retry or dead-letter for a failed delivery.
async fn handle_retry(db: &PgPool, redis: &Client, mut item: WebhookDeliveryItem, error: &str) {
    if item.attempt < MAX_ATTEMPTS {
        let delay = RETRY_DELAYS[item.attempt as usize];
        item.attempt += 1;

        // Sleep before re-enqueue
        tokio::time::sleep(delay).await;

        if let Err(e) = enqueue(redis, &item).await {
            error!(
                webhook_id = %item.webhook_id,
                attempt = item.attempt,
                "Failed to re-enqueue delivery: {}", e
            );
        }
    } else {
        // Dead-letter
        warn!(
            webhook_id = %item.webhook_id,
            event_id = %item.event_id,
            "Webhook delivery exhausted all retries, dead-lettering"
        );

        if let Err(e) = queries::insert_dead_letter(
            db,
            item.webhook_id,
            item.event_type,
            item.event_id,
            &item.payload,
            item.attempt as i32,
            Some(error),
            item.event_time,
        )
        .await
        {
            error!("Failed to insert dead letter: {}", e);
        }
    }
}
