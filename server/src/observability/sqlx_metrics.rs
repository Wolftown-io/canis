//! Tracing layer that records sqlx query durations to the `OTel` histogram.

use std::time::Instant;

use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::registry::LookupSpan;

use super::metrics::record_db_query_duration;

/// Marker stored in span extensions to track query start time.
struct SqlxQueryStart(Instant);

/// Tracing layer that intercepts `sqlx::query` spans and records their
/// duration to the `kaiku_db_query_duration_seconds` histogram.
#[derive(Clone, Copy, Debug, Default)]
pub struct SqlxMetricsLayer;

impl<S> Layer<S> for SqlxMetricsLayer
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(
        &self,
        _attrs: &tracing::span::Attributes<'_>,
        id: &tracing::span::Id,
        ctx: Context<'_, S>,
    ) {
        if let Some(span) = ctx.span(id) {
            if span.metadata().target().starts_with("sqlx") {
                span.extensions_mut().insert(SqlxQueryStart(Instant::now()));
            }
        }
    }

    fn on_close(&self, id: tracing::span::Id, ctx: Context<'_, S>) {
        if let Some(span) = ctx.span(&id) {
            let extensions = span.extensions();
            if let Some(start) = extensions.get::<SqlxQueryStart>() {
                let duration = start.0.elapsed();
                record_db_query_duration(duration.as_secs_f64());
            }
        }
    }
}
