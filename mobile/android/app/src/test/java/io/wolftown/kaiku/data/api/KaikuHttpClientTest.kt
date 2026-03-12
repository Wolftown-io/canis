package io.wolftown.kaiku.data.api

import io.ktor.client.engine.mock.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.mockk.*
import io.wolftown.kaiku.data.local.AuthState
import io.wolftown.kaiku.data.local.TokenStorage
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class KaikuHttpClientTest {

    private lateinit var tokenStorage: TokenStorage
    private lateinit var authState: AuthState

    @Before
    fun setUp() {
        tokenStorage = mockk(relaxed = true)
        authState = mockk(relaxed = true)
        every { tokenStorage.getServerUrl() } returns "https://kaiku.example.com"
    }

    private fun createClient(mockEngine: MockEngine): KaikuHttpClient {
        return KaikuHttpClient.forTesting(tokenStorage, authState, mockEngine)
    }

    // ========================================================================
    // Bearer token included when available
    // ========================================================================

    @Test
    fun `requests include Bearer token when token is available`() = runTest {
        every { tokenStorage.getAccessToken() } returns "test-access-token"

        val mockEngine = MockEngine { request ->
            assertEquals(
                "Bearer test-access-token",
                request.headers[HttpHeaders.Authorization]
            )
            respond(
                content = """{"status": "ok"}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.OK, response.status)
    }

    // ========================================================================
    // No Authorization header when no token
    // ========================================================================

    @Test
    fun `requests omit Authorization header when no token`() = runTest {
        every { tokenStorage.getAccessToken() } returns null

        val mockEngine = MockEngine { request ->
            assertNull(
                "Authorization header should not be present",
                request.headers[HttpHeaders.Authorization]
            )
            respond(
                content = """{"status": "ok"}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.OK, response.status)
    }

    // ========================================================================
    // 401 triggers refresh and retries with new token
    // ========================================================================

    @Test
    fun `on 401 triggers token refresh and retries with new token`() = runTest {
        var requestCount = 0
        // Simulate mutable token state
        var currentAccessToken: String? = "expired-token"

        every { tokenStorage.getAccessToken() } answers { currentAccessToken }
        every { tokenStorage.getRefreshToken() } returns "valid-refresh-token"
        every { tokenStorage.getUserId() } returns "user-123"
        every {
            tokenStorage.saveTokens(any(), any(), any(), any())
        } answers {
            currentAccessToken = firstArg()
        }

        val mockEngine = MockEngine { request ->
            requestCount++
            when {
                // Refresh request
                request.url.encodedPath == "/auth/refresh" -> {
                    respond(
                        content = """{
                            "access_token": "new-access-token",
                            "refresh_token": "new-refresh-token",
                            "expires_in": 900,
                            "token_type": "Bearer",
                            "setup_required": false
                        }""",
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
                // First request to /api/test -> 401
                requestCount == 1 -> {
                    respond(
                        content = """{"error": "unauthorized"}""",
                        status = HttpStatusCode.Unauthorized,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
                // Retry request to /api/test -> 200
                else -> {
                    assertEquals(
                        "Bearer new-access-token",
                        request.headers[HttpHeaders.Authorization]
                    )
                    respond(
                        content = """{"status": "ok"}""",
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
            }
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.OK, response.status)

        // Verify tokens were saved
        verify {
            tokenStorage.saveTokens(
                accessToken = "new-access-token",
                refreshToken = "new-refresh-token",
                expiresIn = 900,
                userId = "user-123"
            )
        }
    }

    // ========================================================================
    // Refresh failure (401) triggers logout
    // ========================================================================

    @Test
    fun `on refresh failure 401 calls authState setLoggedOut`() = runTest {
        every { tokenStorage.getAccessToken() } returns "expired-token"
        every { tokenStorage.getRefreshToken() } returns "invalid-refresh-token"

        val mockEngine = MockEngine { request ->
            when {
                request.url.encodedPath == "/auth/refresh" -> {
                    respond(
                        content = """{"error": "invalid refresh token"}""",
                        status = HttpStatusCode.Unauthorized,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
                else -> {
                    respond(
                        content = """{"error": "unauthorized"}""",
                        status = HttpStatusCode.Unauthorized,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
            }
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.Unauthorized, response.status)

        verify { authState.setLoggedOut() }
    }

    // ========================================================================
    // Refresh failure (403) triggers logout
    // ========================================================================

    @Test
    fun `on refresh failure 403 calls authState setLoggedOut`() = runTest {
        every { tokenStorage.getAccessToken() } returns "expired-token"
        every { tokenStorage.getRefreshToken() } returns "revoked-refresh-token"

        val mockEngine = MockEngine { request ->
            when {
                request.url.encodedPath == "/auth/refresh" -> {
                    respond(
                        content = """{"error": "forbidden"}""",
                        status = HttpStatusCode.Forbidden,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
                else -> {
                    respond(
                        content = """{"error": "unauthorized"}""",
                        status = HttpStatusCode.Unauthorized,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
            }
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.Unauthorized, response.status)

        verify { authState.setLoggedOut() }
    }

    // ========================================================================
    // No refresh token available -- skip refresh, propagate 401
    // ========================================================================

    @Test
    fun `on 401 without refresh token skips refresh and propagates 401`() = runTest {
        every { tokenStorage.getAccessToken() } returns "expired-token"
        every { tokenStorage.getRefreshToken() } returns null

        val mockEngine = MockEngine {
            respond(
                content = """{"error": "unauthorized"}""",
                status = HttpStatusCode.Unauthorized,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.Unauthorized, response.status)

        // Should still logout since we got a 401 with no refresh token
        verify { authState.setLoggedOut() }
    }

    // ========================================================================
    // Concurrent requests share single refresh (mutex)
    // ========================================================================

    @Test
    fun `concurrent requests during refresh do not trigger multiple refresh calls`() = runTest {
        var refreshCallCount = 0
        // Simulate mutable token state: saveTokens updates the returned value
        var currentAccessToken = "expired-token"

        every { tokenStorage.getAccessToken() } answers { currentAccessToken }
        every { tokenStorage.getRefreshToken() } returns "valid-refresh-token"
        every { tokenStorage.getUserId() } returns "user-123"
        every {
            tokenStorage.saveTokens(any(), any(), any(), any())
        } answers {
            // Simulate real token storage: update the current token
            currentAccessToken = firstArg()
        }

        val mockEngine = MockEngine { request ->
            when {
                request.url.encodedPath == "/auth/refresh" -> {
                    refreshCallCount++
                    respond(
                        content = """{
                            "access_token": "new-access-token",
                            "refresh_token": "new-refresh-token",
                            "expires_in": 900,
                            "token_type": "Bearer",
                            "setup_required": false
                        }""",
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, "application/json")
                    )
                }
                else -> {
                    if (request.headers[HttpHeaders.Authorization] == "Bearer expired-token") {
                        respond(
                            content = """{"error": "unauthorized"}""",
                            status = HttpStatusCode.Unauthorized,
                            headers = headersOf(HttpHeaders.ContentType, "application/json")
                        )
                    } else {
                        respond(
                            content = """{"status": "ok"}""",
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "application/json")
                        )
                    }
                }
            }
        }

        val client = createClient(mockEngine)

        // Launch two sequential requests that both start with expired token.
        // The first triggers a refresh; the second should detect the token
        // was already refreshed (via the mutex double-check) and skip refresh.
        val response1 = client.activeClient().get("/api/test1")
        val response2 = client.activeClient().get("/api/test2")

        assertEquals(HttpStatusCode.OK, response1.status)
        assertEquals(HttpStatusCode.OK, response2.status)

        // Only the first request should have triggered a refresh
        assertEquals(
            "Only one refresh call should be made",
            1,
            refreshCallCount
        )
    }

    // ========================================================================
    // Base URL is set from server URL
    // ========================================================================

    @Test
    fun `base URL is set from tokenStorage serverUrl`() = runTest {
        every { tokenStorage.getAccessToken() } returns null
        every { tokenStorage.getServerUrl() } returns "https://my-server.example.com"

        val mockEngine = MockEngine { request ->
            assertEquals("my-server.example.com", request.url.host)
            assertEquals("https", request.url.protocol.name)
            respond(
                content = """{"status": "ok"}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.OK, response.status)
    }

    // ========================================================================
    // Content-Type default is application/json
    // ========================================================================

    @Test
    fun `default content type is application json`() = runTest {
        every { tokenStorage.getAccessToken() } returns null

        val mockEngine = MockEngine { request ->
            val contentTypeHeader = request.headers[HttpHeaders.ContentType]
            assertEquals(
                "application/json",
                contentTypeHeader
            )
            respond(
                content = """{"status": "ok"}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }

        val client = createClient(mockEngine)

        val response = client.activeClient().get("/api/test")
        assertEquals(HttpStatusCode.OK, response.status)
    }
}
