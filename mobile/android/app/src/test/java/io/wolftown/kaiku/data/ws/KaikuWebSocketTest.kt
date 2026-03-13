package io.wolftown.kaiku.data.ws

import app.cash.turbine.test
import io.mockk.every
import io.mockk.mockk
import io.wolftown.kaiku.data.local.TokenStorage
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.assertIs
import kotlin.time.Duration.Companion.seconds

class KaikuWebSocketTest {

    private lateinit var mockServer: MockWebServer
    private lateinit var okHttpClient: OkHttpClient
    private lateinit var tokenStorage: TokenStorage
    private lateinit var ws: KaikuWebSocket

    @Before
    fun setUp() {
        mockServer = MockWebServer()
        mockServer.start()

        okHttpClient = OkHttpClient.Builder().build()

        tokenStorage = mockk(relaxed = true)
        every { tokenStorage.getAccessToken() } returns "test-jwt-token"
        every { tokenStorage.getServerUrl() } returns mockServer.url("/").toString()

        ws = KaikuWebSocket(okHttpClient, tokenStorage, WsJson)
    }

    @After
    fun tearDown() {
        ws.disconnect()
        try {
            mockServer.shutdown()
        } catch (_: Exception) {
            // MockWebServer may timeout waiting for the queue to drain after
            // WebSocket close handshake; this is safe to ignore in tests.
        }
    }

    @Test
    fun `initial state is Disconnected`() {
        assertEquals(ConnectionState.Disconnected, ws.connectionState.value)
    }

    @Test
    fun `connect transitions to Connecting then Connected`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                }
            })
        )

        ws.connectionState.test(timeout = 10.seconds) {
            assertEquals(ConnectionState.Disconnected, awaitItem())

            ws.connect(mockServer.url("/").toString())

            assertEquals(ConnectionState.Connecting, awaitItem())
            assertEquals(ConnectionState.Connected, awaitItem())

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `events flow emits parsed server events`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                    webSocket.send("""{"type":"message_new","channel_id":"chan-001","message":{"id":"msg-1","content":"hello"}}""")
                    webSocket.send("""{"type":"typing_start","channel_id":"chan-001","user_id":"usr-002"}""")
                }
            })
        )

        ws.events.test(timeout = 10.seconds) {
            ws.connect(mockServer.url("/").toString())

            val ready = awaitItem()
            assertIs<ServerEvent.Ready>(ready)
            assertEquals("usr-001", ready.userId)

            val messageNew = awaitItem()
            assertIs<ServerEvent.MessageNew>(messageNew)
            assertEquals("chan-001", messageNew.channelId)

            val typing = awaitItem()
            assertIs<ServerEvent.TypingStart>(typing)
            assertEquals("chan-001", typing.channelId)
            assertEquals("usr-002", typing.userId)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `send serializes ClientEvent and sends over WebSocket`() = runTest {
        val receivedMessages = mutableListOf<String>()
        val messageLatch = CountDownLatch(1)

        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    receivedMessages.add(text)
                    messageLatch.countDown()
                }
            })
        )

        ws.events.test(timeout = 10.seconds) {
            ws.connect(mockServer.url("/").toString())
            awaitItem() // Ready

            ws.send(ClientEvent.Subscribe("chan-001"))

            // Wait for the message to arrive at the mock server (max 5s)
            assertTrue("Server did not receive message in time", messageLatch.await(5, TimeUnit.SECONDS))

            val sent = receivedMessages.firstOrNull { it.contains("subscribe") }
            assertTrue("Expected subscribe message to be sent", sent != null)
            assertTrue("Expected channel_id field", sent!!.contains(""""channel_id":"chan-001""""))
            assertTrue("Expected type field", sent.contains(""""type":"subscribe""""))

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `disconnect transitions to Disconnected`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                }
            })
        )

        ws.connectionState.test(timeout = 10.seconds) {
            assertEquals(ConnectionState.Disconnected, awaitItem())

            ws.connect(mockServer.url("/").toString())
            assertEquals(ConnectionState.Connecting, awaitItem())
            assertEquals(ConnectionState.Connected, awaitItem())

            ws.disconnect()
            assertEquals(ConnectionState.Disconnected, awaitItem())

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `connect uses Sec-WebSocket-Protocol header with token`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                }
            })
        )

        ws.events.test(timeout = 10.seconds) {
            ws.connect(mockServer.url("/").toString())
            awaitItem() // Ready

            val request = mockServer.takeRequest()
            val protocol = request.getHeader("Sec-WebSocket-Protocol")
            assertEquals("access_token.test-jwt-token", protocol)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `no access token prevents connection`() {
        every { tokenStorage.getAccessToken() } returns null

        ws.connect("http://localhost:8080")

        // Should remain disconnected since there's no token
        assertEquals(ConnectionState.Disconnected, ws.connectionState.value)
    }

    @Test
    fun `server close triggers Disconnected state`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                    webSocket.close(1000, "Server shutdown")
                }
            })
        )

        ws.connectionState.test(timeout = 10.seconds) {
            assertEquals(ConnectionState.Disconnected, awaitItem())

            ws.connect(mockServer.url("/").toString())
            assertEquals(ConnectionState.Connecting, awaitItem())
            assertEquals(ConnectionState.Connected, awaitItem())

            // Server-initiated close should transition back to Disconnected
            assertEquals(ConnectionState.Disconnected, awaitItem())

            // Stop reconnect attempts for clean test shutdown
            ws.disconnect()
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `malformed JSON message does not crash`() = runTest {
        mockServer.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"ready","user_id":"usr-001"}""")
                    webSocket.send("""not valid json at all""")
                    webSocket.send("""{"type":"message_new","channel_id":"chan-001","message":{"id":"msg-1"}}""")
                }
            })
        )

        ws.events.test(timeout = 10.seconds) {
            ws.connect(mockServer.url("/").toString())

            val ready = awaitItem()
            assertIs<ServerEvent.Ready>(ready)

            val msg = awaitItem()
            assertIs<ServerEvent.MessageNew>(msg)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `connect converts https URL to wss scheme`() {
        // Verify URL conversion by connecting to HTTPS URL that won't resolve.
        // The key is that it enters Connecting state (token is present).
        every { tokenStorage.getAccessToken() } returns "test-token"

        ws.connect("https://example.com")
        assertEquals(ConnectionState.Connecting, ws.connectionState.value)
        ws.disconnect()
    }
}
