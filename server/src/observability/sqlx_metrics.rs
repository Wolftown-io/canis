//! Tracing layer that records sqlx query durations to the `OTel` histogram.
//!
//! SQLx 0.8 emits `tracing::event!` (not spans) with `target: "sqlx::query"`
//! and includes an `elapsed_secs` field containing the query duration as `f64`.
//! This layer intercepts those events and feeds the duration into the
//! `kaiku_db_query_duration_seconds` histogram.

use tracing::field::{Field, Visit};
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::registry::LookupSpan;

use super::metrics::record_db_query_duration;

/// Visitor that extracts the `elapsed_secs` field from a sqlx query event.
#[derive(Default)]
struct ElapsedSecsVisitor {
    elapsed_secs: Option<f64>,
}

impl Visit for ElapsedSecsVisitor {
    fn record_f64(&mut self, field: &Field, value: f64) {
        if field.name() == "elapsed_secs" {
            self.elapsed_secs = Some(value);
        }
    }

    fn record_debug(&mut self, _field: &Field, _value: &dyn std::fmt::Debug) {}
}

/// Tracing layer that intercepts `sqlx::query` events and records their
/// duration to the `kaiku_db_query_duration_seconds` histogram.
#[derive(Clone, Copy, Debug, Default)]
pub struct SqlxMetricsLayer;

impl<S> Layer<S> for SqlxMetricsLayer
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        if event.metadata().target() != "sqlx::query" {
            return;
        }

        let mut visitor = ElapsedSecsVisitor::default();
        event.record(&mut visitor);

        if let Some(elapsed) = visitor.elapsed_secs {
            record_db_query_duration(elapsed);
        }
    }
}
