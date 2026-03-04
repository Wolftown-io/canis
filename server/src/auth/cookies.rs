//! Cookie helpers for browser-mode refresh token storage.
//!
//! In browser mode the refresh token is stored as an `HttpOnly` cookie
//! so it cannot be read by JavaScript (XSS mitigation).  Tauri clients
//! continue to use the JSON body.

use axum_extra::extract::cookie::{Cookie, SameSite};
use time::Duration;

use crate::config::Config;

/// Cookie name for the refresh token.
pub const REFRESH_COOKIE_NAME: &str = "kaiku_refresh";

/// Build an `HttpOnly` cookie that stores the refresh token.
pub fn build_refresh_cookie<'c>(token: &str, max_age_secs: i64, config: &Config) -> Cookie<'c> {
    let mut cookie = Cookie::build((REFRESH_COOKIE_NAME, token.to_owned()))
        .http_only(true)
        .same_site(SameSite::Strict)
        .path("/auth")
        .secure(config.cookie_secure)
        .max_age(Duration::seconds(max_age_secs))
        .build();

    if let Some(domain) = &config.cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie
}

/// Build a cookie that clears the refresh token (max-age = 0).
pub fn build_clear_cookie(config: &Config) -> Cookie<'static> {
    let mut cookie = Cookie::build((REFRESH_COOKIE_NAME, ""))
        .http_only(true)
        .same_site(SameSite::Strict)
        .path("/auth")
        .secure(config.cookie_secure)
        .max_age(Duration::ZERO)
        .build();

    if let Some(domain) = &config.cookie_domain {
        cookie.set_domain(domain.clone());
    }

    cookie
}
