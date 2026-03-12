package io.wolftown.kaiku.ui.auth

/**
 * Thrown when the server indicates that MFA is required to complete login.
 * This is a domain-level exception used by [AuthRepository] to signal
 * that the caller should prompt for an MFA code.
 */
class MfaRequiredException : Exception("MFA required")
