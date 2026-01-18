# WebRTC Module

**Parent:** [Tauri Source](../AGENTS.md)

**Purpose:** WebRTC peer connection management for real-time voice chat. Handles SDP offer/answer negotiation, ICE candidate exchange, and RTP audio track sending/receiving. **PERFORMANCE CRITICAL** — directly impacts voice latency.

## Architecture

```
Client A                          Server (SFU)                          Client B
   ↓ VoiceJoin                        ↓                                    ↓
WebRtcClient.connect()          Creates SFU Session              WebRtcClient.connect()
   ↓                                  ↓                                    ↓
Wait for SDP offer              VoiceOffer (SDP) →                   Wait for SDP offer
   ↓                                  ↓                                    ↓
handle_offer() → SDP answer     SFU forwards audio                handle_offer() → SDP answer
   ↓                                  ↓                                    ↓
ICE candidates exchanged        ICE candidates exchanged          ICE candidates exchanged
   ↓                                  ↓                                    ↓
WebRTC connected ←─────────── RTP Audio Packets ─────────→ WebRTC connected
   ↓                                  ↓                                    ↓
local_track.write_rtp()         Forward to all peers              Receive remote track
```

## Key Files

### `mod.rs`
Entire WebRTC implementation in one file.

**Key Types:**

#### `WebRtcClient`
Main client struct:
```rust
pub struct WebRtcClient {
    api: Arc<API>,                                       // webrtc-rs API
    peer_connection: Arc<RwLock<Option<RTCPeerConnection>>>, // Peer connection
    audio_sender: Arc<RwLock<Option<RTCRtpSender>>>,     // Audio RTP sender
    local_track: Arc<RwLock<Option<TrackLocalStaticRTP>>>, // Local audio track
    state: Arc<RwLock<ConnectionState>>,                 // Connection state
    channel_id: Arc<RwLock<Option<String>>>,             // Current channel

    // Callbacks
    on_ice_candidate: Arc<RwLock<Option<Box<dyn Fn(String) + Send + Sync>>>>,
    on_state_change: Arc<RwLock<Option<Box<dyn Fn(ConnectionState) + Send + Sync>>>>,
    on_remote_track: Arc<RwLock<Option<Box<dyn Fn(Arc<TrackRemote>) + Send + Sync>>>>,
}
```

#### `ConnectionState`
```rust
enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Failed,
}
```

#### `IceServerConfig`
```rust
struct IceServerConfig {
    urls: Vec<String>,           // STUN/TURN server URLs
    username: Option<String>,    // TURN auth username
    credential: Option<String>,  // TURN auth credential
}
```

**Default:** Google public STUN server (`stun:stun.l.google.com:19302`)

## Key Patterns

### Initialization
Called from `commands/voice.rs::join_voice()`:

```rust
let webrtc = WebRtcClient::new()?; // Initialize API
webrtc.connect(&channel_id, &ice_servers).await?; // Create peer connection
```

**Steps:**
1. **MediaEngine:** Register Opus codec (48kHz, stereo)
2. **Interceptor Registry:** Enable RTCP, NACK, PLI (packet loss handling)
3. **API:** Build webrtc-rs API
4. **Peer Connection:** Create with ICE servers

### SDP Negotiation Flow

#### 1. Client Joins
```rust
webrtc.connect(&channel_id, &ice_servers).await?;
// → Sends VoiceJoin event to server
```

#### 2. Server Sends Offer
```
Server → VoiceOffer { channel_id, sdp }
```

#### 3. Client Creates Answer
```rust
let answer_sdp = webrtc.handle_offer(&sdp).await?;
// → Sends VoiceAnswer { channel_id, sdp: answer_sdp } to server
```

**Inside `handle_offer()`:**
1. Parse SDP offer
2. `peer_connection.set_remote_description(offer)`
3. `peer_connection.create_answer()`
4. `peer_connection.set_local_description(answer)`
5. Return answer SDP string

### ICE Candidate Exchange

#### Client → Server
```rust
webrtc.set_on_ice_candidate(|candidate| {
    // Callback invoked when local ICE candidate discovered
    ws_manager.send(ClientEvent::VoiceIceCandidate { channel_id, candidate });
});
```

#### Server → Client
```
Server → VoiceIceCandidate { channel_id, candidate }
```

```rust
webrtc.add_ice_candidate(&candidate_json).await?;
```

**ICE Gathering:** Continues until all candidates discovered (usually <5s).

### Audio Track Management

#### Local Track (Outgoing Audio)
```rust
let local_track = TrackLocalStaticRTP::new(
    RTCRtpCodecCapability {
        mime_type: "audio/opus",
        clock_rate: 48000,
        channels: 2,
        sdp_fmtp_line: "minptime=10;useinbandfec=1",
    },
    "audio",      // Track ID
    "voice-stream" // Stream ID
);

let sender = peer_connection.add_track(local_track).await?;
```

**Sending RTP:**
```rust
let track = webrtc.get_local_track().await?;
let rtp_packet = RtpPacket {
    header: RtpHeader { /* ... */ },
    payload: encoded_opus_bytes,
};
track.write_rtp(&rtp_packet).await?;
```

**Called from:** `commands/voice.rs` after audio capture and Opus encoding.

#### Remote Track (Incoming Audio)
```rust
webrtc.set_on_remote_track(|track: Arc<TrackRemote>| {
    // Callback invoked when remote peer sends audio
    tokio::spawn(async move {
        loop {
            let (rtp_packet, _attrs) = track.read_rtp().await?;
            // → Send to audio playback pipeline
        }
    });
});
```

**Called from:** WebRTC library when remote peer adds track.

### Lifecycle

#### Connect
```rust
webrtc.connect(&channel_id, &ice_servers).await?;
```
- Creates peer connection
- Adds local audio track
- Sets up callbacks

#### Disconnect
```rust
webrtc.disconnect().await?;
```
- Closes peer connection
- Clears state
- Stops audio

## Performance Targets

| Metric | Target | Why |
|--------|--------|-----|
| ICE gathering | <5s | Fast connection setup |
| RTP packet loss | <1% | Acceptable for Opus FEC |
| Jitter | <30ms | Opus jitter buffer handles this |
| Latency (end-to-end) | <50ms | Voice latency budget (10ms goal, 50ms max) |

## Common Issues

### ICE Connection Fails
**Symptoms:** `ConnectionState::Failed` after timeout (30s default)

**Causes:**
1. **No STUN/TURN servers:** Client behind symmetric NAT, no relay
2. **Firewall blocks UDP:** Corporate firewall blocks WebRTC traffic
3. **Server unreachable:** Wrong URL or server down

**Debug:**
- Check ICE candidate types (host, srflx, relay)
- If only `host` candidates, NAT traversal failed
- Add TURN server (relay fallback)

**Fix:**
```rust
IceServerConfig {
    urls: vec![
        "stun:stun.l.google.com:19302".into(),
        "turn:turn.example.com:3478".into(), // Add TURN
    ],
    username: Some("user".into()),
    credential: Some("pass".into()),
}
```

### No Audio Received
**Symptoms:** WebRTC connected, but no audio playback

**Causes:**
1. **Remote track callback not set:** Audio received but not forwarded
2. **Opus decode fails:** Invalid RTP payload
3. **Playback stream not started:** Audio module not initialized

**Debug:**
- Check `on_remote_track` callback fires
- Log RTP packet reception
- Verify audio playback task running

### Audio Choppy/Glitchy
**Symptoms:** Voice cuts in and out

**Causes:**
1. **Packet loss >5%:** Network congestion
2. **Jitter >100ms:** Unstable network
3. **CPU overload:** Audio callback blocking

**Debug:**
- Check WebRTC stats (packet loss, jitter)
- Monitor CPU usage in audio callback
- Enable Opus in-band FEC (already enabled in config)

## Security

### DTLS-SRTP (Current)
- **Encryption:** DTLS for key exchange, SRTP for RTP encryption
- **Trust:** Server can decrypt (not end-to-end encrypted)
- **Forward Secrecy:** No (keys not rotated)

### MLS (Future "Paranoid Mode")
- **Encryption:** End-to-end with MLS protocol
- **Trust:** Server is blind relay (cannot decrypt)
- **Forward Secrecy:** Yes (ratcheting keys)
- **Trade-off:** ~10-20ms added latency

### ICE Credential Leaking
- **Risk:** TURN credentials in ICE config sent to server
- **Mitigation:** Use short-lived credentials (TURN REST API)
- **Future:** Implement TURN credential rotation

## Testing

### Unit Tests
```rust
#[test]
fn test_webrtc_client_creation() {
    let client = WebRtcClient::new();
    assert!(client.is_ok());
}
```

### Integration Tests
Not yet implemented. Future:
- Two-client WebRTC test (loopback)
- Measure connection setup time
- Test packet loss handling (simulate with netem)

## Future Improvements

1. **WebRTC Stats:** Expose `peer_connection.get_stats()` to frontend
2. **Adaptive Bitrate:** Adjust Opus bitrate based on network conditions
3. **Simulcast:** Send multiple quality streams (not useful for voice)
4. **Data Channels:** Use for non-audio signaling (e.g., screenshare metadata)
5. **MLS Integration:** E2EE voice ("Paranoid Mode")

## Related Documentation

- [Voice Commands](../commands/voice.rs) — Tauri commands that use WebRtcClient
- [Audio Module](../audio/AGENTS.md) — Sends/receives RTP audio
- [Server SFU](../../../../server/src/voice/AGENTS.md) — Server-side voice routing
- [STANDARDS.md](../../../../STANDARDS.md) — WebRTC protocol details
