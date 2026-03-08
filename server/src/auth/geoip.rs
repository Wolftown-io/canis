//! Geo-IP Resolution Service
//!
//! Resolves IP addresses to approximate geographic locations via a configurable
//! HTTP API. Used to enrich session metadata — never blocks authentication.

use serde::Deserialize;
use std::net::IpAddr;

/// Approximate geographic location resolved from an IP address.
#[derive(Debug, Clone, Deserialize)]
pub struct GeoLocation {
    /// City name (e.g., "Berlin")
    pub city: Option<String>,
    /// Country name (e.g., "Germany")
    pub country: Option<String>,
}

/// Resolve an IP address to city/country via a configurable geo-IP API.
///
/// Returns `None` on any failure — this must never block or fail login.
/// Private/loopback addresses are short-circuited without making a request.
pub async fn resolve_location(
    client: &reqwest::Client,
    geoip_api_url: &Option<String>,
    ip: &IpAddr,
) -> Option<GeoLocation> {
    let base_url = geoip_api_url.as_deref()?;

    if ip.is_loopback() || is_private(ip) {
        return None;
    }

    let ip_str = ip.to_string();
    // The placeholder is a literal template marker, not a format argument.
    #[allow(clippy::literal_string_with_formatting_args)]
    let url = base_url.replace("{ip}", &ip_str);

    match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => match resp.json::<GeoLocation>().await {
            Ok(loc) => Some(loc),
            Err(e) => {
                tracing::debug!("GeoIP parse error for {}: {}", ip, e);
                None
            }
        },
        Ok(resp) => {
            tracing::debug!("GeoIP API returned {} for {}", resp.status(), ip);
            None
        }
        Err(e) => {
            tracing::debug!("GeoIP lookup failed for {}: {}", ip, e);
            None
        }
    }
}

/// Check whether an IP address is private or link-local.
const fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}
