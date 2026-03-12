package io.wolftown.kaiku.domain.model

import io.wolftown.kaiku.data.KaikuJson
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SerializationTest {

    // ========================================================================
    // User
    // ========================================================================

    @Test
    fun `User deserializes from snake_case JSON`() {
        val json = """
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "username": "testuser",
            "display_name": "Test User",
            "avatar_url": "https://cdn.example.com/avatar.png",
            "status": "online",
            "mfa_enabled": true,
            "created_at": "2025-01-15T10:30:00Z"
        }
        """.trimIndent()

        val user = KaikuJson.decodeFromString<User>(json)

        assertEquals("550e8400-e29b-41d4-a716-446655440000", user.id)
        assertEquals("testuser", user.username)
        assertEquals("Test User", user.displayName)
        assertEquals("https://cdn.example.com/avatar.png", user.avatarUrl)
        assertEquals("online", user.status)
        assertTrue(user.mfaEnabled)
        assertEquals("2025-01-15T10:30:00Z", user.createdAt)
    }

    @Test
    fun `User deserializes with defaults for optional fields`() {
        val json = """
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "username": "minimal",
            "display_name": "Minimal User"
        }
        """.trimIndent()

        val user = KaikuJson.decodeFromString<User>(json)

        assertNull(user.avatarUrl)
        assertEquals("offline", user.status)
        assertFalse(user.mfaEnabled)
        assertEquals("", user.createdAt)
    }

    @Test
    fun `User roundtrip preserves all fields`() {
        val user = User(
            id = "550e8400-e29b-41d4-a716-446655440000",
            username = "roundtrip",
            displayName = "Roundtrip User",
            avatarUrl = "https://cdn.example.com/avatar.png",
            status = "away",
            mfaEnabled = true,
            createdAt = "2025-01-15T10:30:00Z"
        )

        val encoded = KaikuJson.encodeToString(user)
        val decoded = KaikuJson.decodeFromString<User>(encoded)

        assertEquals(user, decoded)
    }

    @Test
    fun `User ignores unknown keys from server`() {
        val json = """
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "username": "testuser",
            "display_name": "Test User",
            "email": "test@example.com",
            "password_hash": "secret",
            "future_field": 42
        }
        """.trimIndent()

        val user = KaikuJson.decodeFromString<User>(json)
        assertEquals("testuser", user.username)
    }

    // ========================================================================
    // Guild
    // ========================================================================

    @Test
    fun `Guild deserializes from snake_case JSON`() {
        val json = """
        {
            "id": "guild-uuid-001",
            "name": "Test Guild",
            "description": "A test guild",
            "icon_url": "https://cdn.example.com/icon.png",
            "member_count": 42,
            "created_at": "2025-02-01T12:00:00Z"
        }
        """.trimIndent()

        val guild = KaikuJson.decodeFromString<Guild>(json)

        assertEquals("guild-uuid-001", guild.id)
        assertEquals("Test Guild", guild.name)
        assertEquals("A test guild", guild.description)
        assertEquals("https://cdn.example.com/icon.png", guild.iconUrl)
        assertEquals(42, guild.memberCount)
        assertEquals("2025-02-01T12:00:00Z", guild.createdAt)
    }

    @Test
    fun `Guild deserializes with defaults`() {
        val json = """
        {
            "id": "guild-uuid-002",
            "name": "Minimal Guild"
        }
        """.trimIndent()

        val guild = KaikuJson.decodeFromString<Guild>(json)

        assertNull(guild.description)
        assertNull(guild.iconUrl)
        assertEquals(0, guild.memberCount)
        assertEquals("", guild.createdAt)
    }

    @Test
    fun `Guild roundtrip preserves all fields`() {
        val guild = Guild(
            id = "guild-uuid-001",
            name = "Roundtrip Guild",
            description = "Desc",
            iconUrl = "https://cdn.example.com/icon.png",
            memberCount = 99,
            createdAt = "2025-02-01T12:00:00Z"
        )

        val encoded = KaikuJson.encodeToString(guild)
        val decoded = KaikuJson.decodeFromString<Guild>(encoded)

        assertEquals(guild, decoded)
    }

    // ========================================================================
    // Channel
    // ========================================================================

    @Test
    fun `Channel deserializes from snake_case JSON`() {
        val json = """
        {
            "id": "chan-uuid-001",
            "name": "general",
            "channel_type": "text",
            "category_id": "cat-uuid-001",
            "topic": "General discussion",
            "user_limit": null,
            "position": 0,
            "created_at": "2025-01-20T08:00:00Z"
        }
        """.trimIndent()

        val channel = KaikuJson.decodeFromString<Channel>(json)

        assertEquals("chan-uuid-001", channel.id)
        assertEquals("general", channel.name)
        assertEquals("text", channel.channelType)
        assertEquals("cat-uuid-001", channel.categoryId)
        assertEquals("General discussion", channel.topic)
        assertNull(channel.userLimit)
        assertEquals(0, channel.position)
        assertEquals("2025-01-20T08:00:00Z", channel.createdAt)
    }

    @Test
    fun `Channel deserializes voice channel with user limit`() {
        val json = """
        {
            "id": "chan-uuid-002",
            "name": "Voice Lounge",
            "channel_type": "voice",
            "user_limit": 10,
            "position": 1
        }
        """.trimIndent()

        val channel = KaikuJson.decodeFromString<Channel>(json)

        assertEquals("voice", channel.channelType)
        assertEquals(10, channel.userLimit)
    }

    @Test
    fun `Channel roundtrip preserves all fields`() {
        val channel = Channel(
            id = "chan-uuid-001",
            name = "roundtrip",
            channelType = "text",
            categoryId = "cat-001",
            topic = "Topic",
            userLimit = 25,
            position = 3,
            createdAt = "2025-01-20T08:00:00Z"
        )

        val encoded = KaikuJson.encodeToString(channel)
        val decoded = KaikuJson.decodeFromString<Channel>(encoded)

        assertEquals(channel, decoded)
    }

    // ========================================================================
    // Attachment
    // ========================================================================

    @Test
    fun `Attachment deserializes from snake_case JSON`() {
        val json = """
        {
            "id": "att-uuid-001",
            "filename": "screenshot.png",
            "mime_type": "image/png",
            "size": 1048576,
            "url": "https://cdn.example.com/files/screenshot.png",
            "width": 1920,
            "height": 1080,
            "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
            "thumbnail_url": "https://cdn.example.com/thumb/screenshot.png",
            "medium_url": "https://cdn.example.com/medium/screenshot.png"
        }
        """.trimIndent()

        val attachment = KaikuJson.decodeFromString<Attachment>(json)

        assertEquals("att-uuid-001", attachment.id)
        assertEquals("screenshot.png", attachment.filename)
        assertEquals("image/png", attachment.mimeType)
        assertEquals(1048576L, attachment.size)
        assertEquals("https://cdn.example.com/files/screenshot.png", attachment.url)
        assertEquals(1920, attachment.width)
        assertEquals(1080, attachment.height)
        assertEquals("LEHV6nWB2yk8pyo0adR*.7kCMdnj", attachment.blurhash)
        assertEquals("https://cdn.example.com/thumb/screenshot.png", attachment.thumbnailUrl)
        assertEquals("https://cdn.example.com/medium/screenshot.png", attachment.mediumUrl)
    }

    @Test
    fun `Attachment deserializes non-image without dimensions`() {
        val json = """
        {
            "id": "att-uuid-002",
            "filename": "document.pdf",
            "mime_type": "application/pdf",
            "size": 524288,
            "url": "https://cdn.example.com/files/document.pdf"
        }
        """.trimIndent()

        val attachment = KaikuJson.decodeFromString<Attachment>(json)

        assertNull(attachment.width)
        assertNull(attachment.height)
        assertNull(attachment.blurhash)
        assertNull(attachment.thumbnailUrl)
        assertNull(attachment.mediumUrl)
    }

    @Test
    fun `Attachment roundtrip preserves all fields`() {
        val attachment = Attachment(
            id = "att-uuid-001",
            filename = "test.png",
            mimeType = "image/png",
            size = 2048L,
            url = "https://cdn.example.com/test.png",
            width = 800,
            height = 600,
            blurhash = "LEHV6nWB",
            thumbnailUrl = "https://cdn.example.com/thumb/test.png",
            mediumUrl = "https://cdn.example.com/medium/test.png"
        )

        val encoded = KaikuJson.encodeToString(attachment)
        val decoded = KaikuJson.decodeFromString<Attachment>(encoded)

        assertEquals(attachment, decoded)
    }

    // ========================================================================
    // Message
    // ========================================================================

    @Test
    fun `Message deserializes from snake_case JSON with nested objects`() {
        val json = """
        {
            "id": "msg-uuid-001",
            "channel_id": "chan-uuid-001",
            "author": {
                "id": "user-uuid-001",
                "username": "sender",
                "display_name": "The Sender",
                "status": "online"
            },
            "content": "Hello, world!",
            "encrypted": false,
            "attachments": [
                {
                    "id": "att-uuid-001",
                    "filename": "image.png",
                    "mime_type": "image/png",
                    "size": 1024,
                    "url": "https://cdn.example.com/image.png"
                }
            ],
            "reply_to": "msg-uuid-000",
            "edited_at": "2025-03-01T15:00:00Z",
            "created_at": "2025-03-01T14:30:00Z"
        }
        """.trimIndent()

        val message = KaikuJson.decodeFromString<Message>(json)

        assertEquals("msg-uuid-001", message.id)
        assertEquals("chan-uuid-001", message.channelId)
        assertEquals("sender", message.author.username)
        assertEquals("The Sender", message.author.displayName)
        assertEquals("Hello, world!", message.content)
        assertFalse(message.encrypted)
        assertEquals(1, message.attachments.size)
        assertEquals("image.png", message.attachments[0].filename)
        assertEquals("msg-uuid-000", message.replyTo)
        assertEquals("2025-03-01T15:00:00Z", message.editedAt)
        assertEquals("2025-03-01T14:30:00Z", message.createdAt)
    }

    @Test
    fun `Message deserializes minimal message`() {
        val json = """
        {
            "id": "msg-uuid-002",
            "channel_id": "chan-uuid-001",
            "author": {
                "id": "user-uuid-001",
                "username": "sender",
                "display_name": "Sender"
            },
            "content": "Short message"
        }
        """.trimIndent()

        val message = KaikuJson.decodeFromString<Message>(json)

        assertFalse(message.encrypted)
        assertTrue(message.attachments.isEmpty())
        assertNull(message.replyTo)
        assertNull(message.editedAt)
        assertEquals("", message.createdAt)
    }

    @Test
    fun `Message roundtrip preserves all fields`() {
        val message = Message(
            id = "msg-uuid-001",
            channelId = "chan-uuid-001",
            author = User(
                id = "user-uuid-001",
                username = "sender",
                displayName = "Sender"
            ),
            content = "Test message",
            encrypted = true,
            attachments = listOf(
                Attachment(
                    id = "att-001",
                    filename = "file.txt",
                    mimeType = "text/plain",
                    size = 100L,
                    url = "https://cdn.example.com/file.txt"
                )
            ),
            replyTo = "msg-uuid-000",
            editedAt = "2025-03-01T15:00:00Z",
            createdAt = "2025-03-01T14:30:00Z"
        )

        val encoded = KaikuJson.encodeToString(message)
        val decoded = KaikuJson.decodeFromString<Message>(encoded)

        assertEquals(message, decoded)
    }

    // ========================================================================
    // AuthResponse
    // ========================================================================

    @Test
    fun `AuthResponse deserializes from snake_case JSON`() {
        val json = """
        {
            "access_token": "eyJhbGciOiJSUzI1NiJ9.test.signature",
            "refresh_token": "refresh-token-value",
            "expires_in": 900,
            "token_type": "Bearer",
            "setup_required": false
        }
        """.trimIndent()

        val response = KaikuJson.decodeFromString<AuthResponse>(json)

        assertEquals("eyJhbGciOiJSUzI1NiJ9.test.signature", response.accessToken)
        assertEquals("refresh-token-value", response.refreshToken)
        assertEquals(900, response.expiresIn)
        assertEquals("Bearer", response.tokenType)
        assertFalse(response.setupRequired)
    }

    @Test
    fun `AuthResponse deserializes without optional refresh token`() {
        val json = """
        {
            "access_token": "eyJhbGciOiJSUzI1NiJ9.test.signature",
            "expires_in": 900,
            "token_type": "Bearer"
        }
        """.trimIndent()

        val response = KaikuJson.decodeFromString<AuthResponse>(json)

        assertNull(response.refreshToken)
        assertFalse(response.setupRequired)
    }

    @Test
    fun `AuthResponse roundtrip preserves all fields`() {
        val response = AuthResponse(
            accessToken = "access-token",
            refreshToken = "refresh-token",
            expiresIn = 900,
            tokenType = "Bearer",
            setupRequired = true
        )

        val encoded = KaikuJson.encodeToString(response)
        val decoded = KaikuJson.decodeFromString<AuthResponse>(encoded)

        assertEquals(response, decoded)
    }

    // ========================================================================
    // Cross-cutting: snake_case encoding verification
    // ========================================================================

    @Test
    fun `encoded JSON uses snake_case field names`() {
        val user = User(
            id = "test-id",
            username = "test",
            displayName = "Test",
            avatarUrl = "https://example.com/avatar.png",
            mfaEnabled = true
        )

        val json = KaikuJson.encodeToString(user)

        assertTrue("Expected display_name in JSON", json.contains("display_name"))
        assertTrue("Expected avatar_url in JSON", json.contains("avatar_url"))
        assertTrue("Expected mfa_enabled in JSON", json.contains("mfa_enabled"))
        assertTrue("Expected created_at in JSON", json.contains("created_at"))
        assertFalse("Should not contain displayName", json.contains("displayName"))
        assertFalse("Should not contain avatarUrl", json.contains("avatarUrl"))
        assertFalse("Should not contain mfaEnabled", json.contains("mfaEnabled"))
    }
}
