use crate::protocol::{
    CellOverlayState, ClientMessage, CursorWithParticipant, ServerMessage, SlideInfo, Viewport,
};
use crate::session::manager::{SessionError, SessionManager};
use crate::slide::SlideService;
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use metrics::{counter, histogram};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Connection state for a single client
pub struct Connection {
    pub id: Uuid,
    pub session_id: Option<String>,
    pub participant_id: Option<Uuid>,
    pub is_presenter: bool,
    pub last_ping: Instant,
    pub sender: mpsc::Sender<ServerMessage>,
    /// Cached participant name (avoids session lookups on every cursor update)
    pub name: Option<String>,
    /// Cached participant color (avoids session lookups on every cursor update)
    pub color: Option<String>,
}

/// Global connection registry
pub type ConnectionRegistry = Arc<RwLock<HashMap<Uuid, Connection>>>;

/// Session broadcast channels: session_id -> broadcast sender
pub type SessionBroadcasters = Arc<RwLock<HashMap<String, broadcast::Sender<ServerMessage>>>>;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub connections: ConnectionRegistry,
    pub session_manager: Arc<SessionManager>,
    pub session_broadcasters: SessionBroadcasters,
    pub slide_service: Option<Arc<dyn SlideService>>,
    /// Public base URL for link generation (e.g., "https://pathcollab.example.com")
    pub public_base_url: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            session_manager: Arc::new(SessionManager::new()),
            session_broadcasters: Arc::new(RwLock::new(HashMap::new())),
            slide_service: None,
            public_base_url: None,
        }
    }

    pub fn with_session_manager(mut self, session_manager: Arc<SessionManager>) -> Self {
        self.session_manager = session_manager;
        self
    }

    pub fn with_slide_service(mut self, service: Arc<dyn SlideService>) -> Self {
        self.slide_service = Some(service);
        self
    }

    pub fn with_public_base_url(mut self, url: Option<String>) -> Self {
        self.public_base_url = url;
        self
    }

    /// Get or create a broadcast channel for a session
    pub async fn get_session_broadcaster(
        &self,
        session_id: &str,
    ) -> broadcast::Sender<ServerMessage> {
        let mut broadcasters = self.session_broadcasters.write().await;
        if let Some(sender) = broadcasters.get(session_id) {
            sender.clone()
        } else {
            // Create new broadcast channel with capacity for 64 messages
            let (tx, _) = broadcast::channel(64);
            broadcasters.insert(session_id.to_string(), tx.clone());
            tx
        }
    }

    /// Broadcast a message to all participants in a session
    pub async fn broadcast_to_session(&self, session_id: &str, msg: ServerMessage) {
        let start = Instant::now();
        let broadcasters = self.session_broadcasters.read().await;
        if let Some(sender) = broadcasters.get(session_id) {
            let msg_type = msg.message_type();
            let receiver_count = sender.receiver_count();

            // Ignore send errors (no receivers)
            let result = sender.send(msg);

            // Record metrics
            histogram!("pathcollab_ws_broadcast_duration_seconds", "type" => msg_type)
                .record(start.elapsed());
            counter!("pathcollab_ws_broadcasts_total", "type" => msg_type).increment(1);
            histogram!("pathcollab_ws_broadcast_recipients").record(receiver_count as f64);

            if result.is_err() {
                counter!("pathcollab_ws_broadcast_errors_total", "type" => msg_type).increment(1);
            }
        }
    }

    /// Get server statistics for monitoring (async version)
    pub async fn get_stats(&self) -> (usize, usize) {
        let sessions = self.session_manager.session_count_async().await;
        let connections = self.connections.read().await.len();
        (sessions, connections)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Configuration for WebSocket connections
pub struct WsConfig {
    pub ping_interval: Duration,
    pub ping_timeout: Duration,
    pub max_message_size: usize,
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            ping_interval: Duration::from_secs(30),
            ping_timeout: Duration::from_secs(10),
            max_message_size: 64 * 1024, // 64KB
        }
    }
}

/// WebSocket upgrade handler
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle a WebSocket connection
async fn handle_socket(socket: WebSocket, state: AppState) {
    let connection_id = Uuid::new_v4();
    info!("New WebSocket connection: {}", connection_id);

    // Create channel for outgoing messages
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(32);

    // Register connection
    {
        let mut connections = state.connections.write().await;
        connections.insert(
            connection_id,
            Connection {
                id: connection_id,
                session_id: None,
                participant_id: None,
                is_presenter: false,
                last_ping: Instant::now(),
                sender: tx.clone(),
                name: None,
                color: None,
            },
        );
    }

    // Split socket into sender and receiver
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Spawn task to forward outgoing messages to WebSocket
    let send_task = tokio::spawn(async move {
        use futures_util::SinkExt;
        while let Some(msg) = rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if ws_sender.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("Failed to serialize message: {}", e);
                }
            }
        }
    });

    // Spawn ping task
    let ping_tx = tx.clone();
    let ping_state = state.clone();
    let ping_connection_id = connection_id;
    let ping_task = tokio::spawn(async move {
        let config = WsConfig::default();
        let mut interval = tokio::time::interval(config.ping_interval);

        loop {
            interval.tick().await;

            // Check if connection is still alive
            let should_close = {
                let connections = ping_state.connections.read().await;
                if let Some(conn) = connections.get(&ping_connection_id) {
                    conn.last_ping.elapsed() > config.ping_timeout + config.ping_interval
                } else {
                    true
                }
            };

            if should_close {
                debug!("Connection {} timed out", ping_connection_id);
                break;
            }

            // Send ping (client may respond, or we just use any activity as keepalive)
            if ping_tx.send(ServerMessage::Ping).await.is_err() {
                break;
            }
        }
    });

    // Spawn task to forward broadcast messages to client
    let broadcast_tx = tx.clone();
    let broadcast_state = state.clone();
    let broadcast_connection_id = connection_id;
    let broadcast_task = tokio::spawn(async move {
        // Poll for session_id and subscribe when available
        let mut current_session_id: Option<String> = None;
        let mut broadcast_rx: Option<broadcast::Receiver<ServerMessage>> = None;

        loop {
            // Check if session_id changed
            let session_id = {
                let connections = broadcast_state.connections.read().await;
                connections
                    .get(&broadcast_connection_id)
                    .and_then(|c| c.session_id.clone())
            };

            // If session changed, subscribe to new broadcast
            if session_id != current_session_id {
                if let Some(ref sid) = session_id {
                    let broadcaster = broadcast_state.get_session_broadcaster(sid).await;
                    broadcast_rx = Some(broadcaster.subscribe());
                    debug!(
                        "Connection {} subscribed to session {} broadcasts",
                        broadcast_connection_id, sid
                    );
                } else {
                    broadcast_rx = None;
                }
                current_session_id = session_id;
            }

            // Forward broadcast messages
            if let Some(ref mut rx) = broadcast_rx {
                match tokio::time::timeout(Duration::from_millis(100), rx.recv()).await {
                    Ok(Ok(msg)) => {
                        if broadcast_tx.send(msg).await.is_err() {
                            break;
                        }
                    }
                    Ok(Err(broadcast::error::RecvError::Lagged(n))) => {
                        warn!(
                            "Broadcast lagged {} messages for {}",
                            n, broadcast_connection_id
                        );
                    }
                    Ok(Err(broadcast::error::RecvError::Closed)) => {
                        broadcast_rx = None;
                        current_session_id = None;
                    }
                    Err(_) => {
                        // Timeout - continue polling
                    }
                }
            } else {
                // No session yet, wait before checking again
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    });

    // Handle incoming messages
    use futures_util::StreamExt;
    while let Some(result) = ws_receiver.next().await {
        match result {
            Ok(msg) => {
                match msg {
                    Message::Text(text) => {
                        // Update last ping time
                        {
                            let mut connections = state.connections.write().await;
                            if let Some(conn) = connections.get_mut(&connection_id) {
                                conn.last_ping = Instant::now();
                            }
                        }

                        // Parse and handle message
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(client_msg) => {
                                handle_client_message(client_msg, connection_id, &state, &tx).await;
                            }
                            Err(e) => {
                                warn!("Failed to parse client message: {}", e);
                                let _ = tx
                                    .send(ServerMessage::SessionError {
                                        code: crate::protocol::ErrorCode::InvalidMessage,
                                        message: format!("Invalid message format: {}", e),
                                    })
                                    .await;
                            }
                        }
                    }
                    Message::Binary(data) => {
                        // Binary messages not currently used - log and ignore
                        // Future: MessagePack-encoded presence updates for performance
                        debug!("Received binary message ({} bytes), ignoring", data.len());
                    }
                    Message::Ping(data) => {
                        // Handled by axum automatically with pong
                        debug!("Received ping: {:?}", data);
                    }
                    Message::Pong(_) => {
                        // Update last ping time
                        let mut connections = state.connections.write().await;
                        if let Some(conn) = connections.get_mut(&connection_id) {
                            conn.last_ping = Instant::now();
                        }
                    }
                    Message::Close(_) => {
                        info!("Client {} requested close", connection_id);
                        break;
                    }
                }
            }
            Err(e) => {
                error!("WebSocket error for {}: {}", connection_id, e);
                break;
            }
        }
    }

    // Cleanup: handle participant removal from session
    let (session_id, participant_id) = {
        let connections = state.connections.read().await;
        let conn = connections.get(&connection_id);
        (
            conn.and_then(|c| c.session_id.clone()),
            conn.and_then(|c| c.participant_id),
        )
    };

    if let (Some(session_id), Some(participant_id)) = (session_id, participant_id) {
        match state
            .session_manager
            .remove_participant(&session_id, participant_id)
            .await
        {
            Ok(was_presenter) => {
                // Broadcast participant left
                state
                    .broadcast_to_session(
                        &session_id,
                        ServerMessage::ParticipantLeft { participant_id },
                    )
                    .await;

                if was_presenter {
                    info!(
                        "Presenter {} disconnected from session {}, grace period started",
                        participant_id, session_id
                    );
                }
            }
            Err(e) => {
                debug!("Failed to remove participant from session: {}", e);
            }
        }
    }

    // Cleanup tasks
    ping_task.abort();
    send_task.abort();
    broadcast_task.abort();

    // Remove from registry
    {
        let mut connections = state.connections.write().await;
        connections.remove(&connection_id);
    }

    info!("WebSocket connection closed: {}", connection_id);
}

/// Scope guard that records message handling latency on drop
struct MessageMetricsGuard {
    start: Instant,
    msg_type: &'static str,
}

impl Drop for MessageMetricsGuard {
    fn drop(&mut self) {
        histogram!("pathcollab_ws_message_duration_seconds", "type" => self.msg_type)
            .record(self.start.elapsed());
    }
}

/// Handle a parsed client message
async fn handle_client_message(
    msg: ClientMessage,
    connection_id: Uuid,
    state: &AppState,
    tx: &mpsc::Sender<ServerMessage>,
) {
    let msg_type = msg.message_type();

    // This guard will record the histogram on all exit paths (including early returns)
    let _metrics_guard = MessageMetricsGuard {
        start: Instant::now(),
        msg_type,
    };

    // Record message received
    counter!("pathcollab_ws_messages_total", "type" => msg_type, "direction" => "in").increment(1);

    match msg {
        ClientMessage::Ping { seq } => {
            let _ = tx.send(ServerMessage::Pong).await;
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Ok,
                    reason: None,
                })
                .await;
        }
        ClientMessage::CreateSession { slide_id, seq } => {
            info!(
                "Create session request from {}: slide={}",
                connection_id, slide_id
            );

            // Fetch slide metadata from slide service
            let slide_service = match &state.slide_service {
                Some(service) => service,
                None => {
                    error!("No slide service configured");
                    let _ = tx
                        .send(ServerMessage::SessionError {
                            code: crate::protocol::ErrorCode::InvalidSlide,
                            message: "Slide service not available".to_string(),
                        })
                        .await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some("Slide service not available".to_string()),
                        })
                        .await;
                    return;
                }
            };

            let slide = match slide_service.get_slide(&slide_id).await {
                Ok(metadata) => SlideInfo {
                    id: metadata.id,
                    name: metadata.name,
                    width: metadata.width,
                    height: metadata.height,
                    tile_size: metadata.tile_size,
                    num_levels: metadata.num_levels,
                    tile_url_template: format!(
                        "/api/slide/{}/tile/{{level}}/{{x}}/{{y}}",
                        slide_id
                    ),
                },
                Err(e) => {
                    error!("Failed to get slide metadata: {}", e);
                    let _ = tx
                        .send(ServerMessage::SessionError {
                            code: crate::protocol::ErrorCode::InvalidSlide,
                            message: format!("Slide not found: {}", e),
                        })
                        .await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some(format!("Slide not found: {}", e)),
                        })
                        .await;
                    return;
                }
            };

            match state
                .session_manager
                .create_session(slide, connection_id)
                .await
            {
                Ok((session, join_secret, presenter_key)) => {
                    let session_id = session.id.clone();
                    let presenter_id = session.presenter_id;

                    // Get presenter info from the session for caching
                    let (presenter_name, presenter_color) = session
                        .participants
                        .get(&presenter_id)
                        .map(|p| (p.name.clone(), p.color.clone()))
                        .unwrap_or_else(|| ("Unknown".to_string(), "#888888".to_string()));

                    // Update connection with session info and cached participant data
                    {
                        let mut connections = state.connections.write().await;
                        if let Some(conn) = connections.get_mut(&connection_id) {
                            conn.session_id = Some(session_id.clone());
                            conn.participant_id = Some(presenter_id);
                            conn.is_presenter = true;
                            conn.name = Some(presenter_name);
                            conn.color = Some(presenter_color);
                        }
                    }

                    // Get session snapshot
                    let snapshot = match state.session_manager.get_session(&session_id).await {
                        Ok(s) => s,
                        Err(e) => {
                            error!(
                                "Failed to retrieve newly created session {}: {}",
                                session_id, e
                            );
                            let _ = tx
                                .send(ServerMessage::SessionError {
                                    code: crate::protocol::ErrorCode::InvalidSlide,
                                    message: "Internal error: session created but not retrievable"
                                        .to_string(),
                                })
                                .await;
                            return;
                        }
                    };

                    let _ = tx
                        .send(ServerMessage::SessionCreated {
                            session: snapshot,
                            join_secret,
                            presenter_key,
                        })
                        .await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Ok,
                            reason: None,
                        })
                        .await;

                    info!("Session {} created by {}", session_id, connection_id);
                }
                Err(e) => {
                    error!("Failed to create session: {}", e);
                    let _ = tx
                        .send(ServerMessage::SessionError {
                            code: crate::protocol::ErrorCode::InvalidSlide,
                            message: format!("Failed to create session: {}", e),
                        })
                        .await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some(e.to_string()),
                        })
                        .await;
                }
            }
        }
        ClientMessage::JoinSession {
            session_id,
            join_secret,
            last_seen_rev: _,
            seq,
        } => {
            info!(
                "Join session request from {}: session={}",
                connection_id, session_id
            );

            match state
                .session_manager
                .join_session(&session_id, &join_secret)
                .await
            {
                Ok((snapshot, participant)) => {
                    let participant_id = participant.id;
                    let participant_name = participant.name.clone();
                    let participant_color = participant.color.clone();

                    // Update connection with session info and cached participant data
                    {
                        let mut connections = state.connections.write().await;
                        if let Some(conn) = connections.get_mut(&connection_id) {
                            conn.session_id = Some(session_id.clone());
                            conn.participant_id = Some(participant_id);
                            conn.is_presenter = false;
                            conn.name = Some(participant_name.clone());
                            conn.color = Some(participant_color.clone());
                        }
                    }

                    // Send session joined to this client
                    let _ = tx
                        .send(ServerMessage::SessionJoined {
                            session: snapshot.clone(),
                            you: participant.clone(),
                        })
                        .await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Ok,
                            reason: None,
                        })
                        .await;

                    // Broadcast participant_joined to session
                    state
                        .broadcast_to_session(
                            &session_id,
                            ServerMessage::ParticipantJoined {
                                participant: participant.clone(),
                            },
                        )
                        .await;

                    info!(
                        "Participant {} ({}) joined session {}",
                        participant.name, participant_id, session_id
                    );
                }
                Err(e) => {
                    let (code, message) = match &e {
                        SessionError::NotFound(_) | SessionError::InvalidJoinSecret => {
                            // Generic message that doesn't reveal if session exists
                            (
                                crate::protocol::ErrorCode::SessionNotFound,
                                "Session not found or invalid credentials".to_string(),
                            )
                        }
                        SessionError::SessionFull(_) => {
                            (crate::protocol::ErrorCode::SessionFull, e.to_string())
                        }
                        SessionError::SessionExpired => {
                            (crate::protocol::ErrorCode::SessionExpired, e.to_string())
                        }
                        SessionError::SessionLocked => {
                            // Session exists but is locked - safe to reveal since they had valid session ID
                            (
                                crate::protocol::ErrorCode::SessionFull,
                                "Session is locked".to_string(),
                            )
                        }
                        _ => (
                            crate::protocol::ErrorCode::SessionNotFound,
                            "Session not found or invalid credentials".to_string(),
                        ),
                    };
                    let _ = tx.send(ServerMessage::SessionError { code, message }).await;
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some(e.to_string()),
                        })
                        .await;
                }
            }
        }
        ClientMessage::CursorUpdate { x, y, seq: _ } => {
            // Get session and participant info from cached connection data
            let (session_id, participant_id, name, color, is_presenter) = {
                let connections = state.connections.read().await;
                let conn = connections.get(&connection_id);
                (
                    conn.and_then(|c| c.session_id.clone()),
                    conn.and_then(|c| c.participant_id),
                    conn.and_then(|c| c.name.clone()),
                    conn.and_then(|c| c.color.clone()),
                    conn.is_some_and(|c| c.is_presenter),
                )
            };

            if let (Some(session_id), Some(participant_id), Some(name), Some(color)) =
                (session_id, participant_id, name, color)
            {
                // Update cursor in session
                if let Err(e) = state
                    .session_manager
                    .update_cursor(&session_id, participant_id, x, y)
                    .await
                {
                    debug!("Failed to update cursor: {}", e);
                    return;
                }

                let cursor = CursorWithParticipant {
                    participant_id,
                    name,
                    color,
                    is_presenter,
                    x,
                    y,
                };

                // Broadcast cursor update to session
                state
                    .broadcast_to_session(
                        &session_id,
                        ServerMessage::PresenceDelta {
                            changed: vec![cursor],
                            removed: vec![],
                            server_ts: crate::session::state::now_millis(),
                        },
                    )
                    .await;
            }
        }
        ClientMessage::ViewportUpdate {
            center_x,
            center_y,
            zoom,
            seq: _,
        } => {
            // Get session and presenter status
            let (session_id, is_presenter) = {
                let connections = state.connections.read().await;
                let conn = connections.get(&connection_id);
                (
                    conn.and_then(|c| c.session_id.clone()),
                    conn.is_some_and(|c| c.is_presenter),
                )
            };

            if let Some(session_id) = session_id {
                let viewport = Viewport {
                    center_x,
                    center_y,
                    zoom,
                    timestamp: crate::session::state::now_millis(),
                };

                // Only broadcast presenter viewport to followers
                if is_presenter {
                    if let Err(e) = state
                        .session_manager
                        .update_presenter_viewport(&session_id, viewport.clone())
                        .await
                    {
                        debug!("Failed to update presenter viewport: {}", e);
                        return;
                    }

                    state
                        .broadcast_to_session(
                            &session_id,
                            ServerMessage::PresenterViewport { viewport },
                        )
                        .await;
                }
            }
        }
        ClientMessage::PresenterAuth { presenter_key, seq } => {
            // Get session ID
            let session_id = {
                let connections = state.connections.read().await;
                connections
                    .get(&connection_id)
                    .and_then(|c| c.session_id.clone())
            };

            match session_id {
                Some(session_id) => {
                    match state
                        .session_manager
                        .authenticate_presenter(&session_id, &presenter_key)
                        .await
                    {
                        Ok(()) => {
                            // Mark connection as presenter
                            {
                                let mut connections = state.connections.write().await;
                                if let Some(conn) = connections.get_mut(&connection_id) {
                                    conn.is_presenter = true;
                                }
                            }
                            let _ = tx
                                .send(ServerMessage::Ack {
                                    ack_seq: seq,
                                    status: crate::protocol::AckStatus::Ok,
                                    reason: None,
                                })
                                .await;
                            info!("Connection {} authenticated as presenter", connection_id);
                        }
                        Err(e) => {
                            let _ = tx
                                .send(ServerMessage::Ack {
                                    ack_seq: seq,
                                    status: crate::protocol::AckStatus::Rejected,
                                    reason: Some(e.to_string()),
                                })
                                .await;
                        }
                    }
                }
                None => {
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some("Not in a session".to_string()),
                        })
                        .await;
                }
            }
        }
        ClientMessage::SnapToPresenter { seq } => {
            // Get presenter viewport and send it back
            let session_id = {
                let connections = state.connections.read().await;
                connections
                    .get(&connection_id)
                    .and_then(|c| c.session_id.clone())
            };

            #[allow(clippy::collapsible_if)]
            if let Some(session_id) = session_id {
                if let Ok(snapshot) = state.session_manager.get_session(&session_id).await {
                    let _ = tx
                        .send(ServerMessage::PresenterViewport {
                            viewport: snapshot.presenter_viewport,
                        })
                        .await;
                }
            }

            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Ok,
                    reason: None,
                })
                .await;
        }
        ClientMessage::ChangeSlide { slide_id, seq } => {
            // Get session ID and presenter status
            let (session_id, is_presenter) = {
                let connections = state.connections.read().await;
                let conn = connections.get(&connection_id);
                (
                    conn.and_then(|c| c.session_id.clone()),
                    conn.is_some_and(|c| c.is_presenter),
                )
            };

            // Only presenter can change slides
            if !is_presenter {
                let _ = tx
                    .send(ServerMessage::Ack {
                        ack_seq: seq,
                        status: crate::protocol::AckStatus::Rejected,
                        reason: Some("Only presenter can change slides".to_string()),
                    })
                    .await;
                return;
            }

            if let Some(session_id) = session_id {
                // Fetch slide metadata
                let slide = if let Some(ref slide_service) = state.slide_service {
                    match slide_service.get_slide(&slide_id).await {
                        Ok(metadata) => SlideInfo {
                            id: metadata.id,
                            name: metadata.name,
                            width: metadata.width,
                            height: metadata.height,
                            tile_size: metadata.tile_size,
                            num_levels: metadata.num_levels,
                            tile_url_template: format!(
                                "/api/slide/{}/tile/{{level}}/{{x}}/{{y}}",
                                slide_id
                            ),
                        },
                        Err(e) => {
                            let _ = tx
                                .send(ServerMessage::Ack {
                                    ack_seq: seq,
                                    status: crate::protocol::AckStatus::Rejected,
                                    reason: Some(format!("Slide not found: {}", e)),
                                })
                                .await;
                            return;
                        }
                    }
                } else {
                    let _ = tx
                        .send(ServerMessage::Ack {
                            ack_seq: seq,
                            status: crate::protocol::AckStatus::Rejected,
                            reason: Some("Slide service not configured".to_string()),
                        })
                        .await;
                    return;
                };

                // Update session with new slide
                match state
                    .session_manager
                    .change_slide(&session_id, slide.clone())
                    .await
                {
                    Ok(new_slide) => {
                        // Broadcast slide change to all participants
                        state
                            .broadcast_to_session(
                                &session_id,
                                ServerMessage::SlideChanged { slide: new_slide },
                            )
                            .await;

                        let _ = tx
                            .send(ServerMessage::Ack {
                                ack_seq: seq,
                                status: crate::protocol::AckStatus::Ok,
                                reason: None,
                            })
                            .await;

                        info!(
                            "Session {} slide changed to {} by presenter",
                            session_id, slide_id
                        );
                    }
                    Err(e) => {
                        let _ = tx
                            .send(ServerMessage::Ack {
                                ack_seq: seq,
                                status: crate::protocol::AckStatus::Rejected,
                                reason: Some(e.to_string()),
                            })
                            .await;
                    }
                }
            } else {
                let _ = tx
                    .send(ServerMessage::Ack {
                        ack_seq: seq,
                        status: crate::protocol::AckStatus::Rejected,
                        reason: Some("Not in a session".to_string()),
                    })
                    .await;
            }
        }
        ClientMessage::CellOverlayUpdate {
            enabled,
            opacity,
            visible_cell_types,
            seq,
        } => {
            // Get session ID and presenter status
            let (session_id, is_presenter) = {
                let connections = state.connections.read().await;
                let conn = connections.get(&connection_id);
                (
                    conn.and_then(|c| c.session_id.clone()),
                    conn.is_some_and(|c| c.is_presenter),
                )
            };

            // Only presenter can broadcast cell overlay updates
            if !is_presenter {
                let _ = tx
                    .send(ServerMessage::Ack {
                        ack_seq: seq,
                        status: crate::protocol::AckStatus::Rejected,
                        reason: Some("Only presenter can update cell overlay".to_string()),
                    })
                    .await;
                return;
            }

            if let Some(session_id) = session_id {
                let cell_overlay = CellOverlayState {
                    enabled,
                    opacity,
                    visible_cell_types: visible_cell_types.clone(),
                };

                // Update session state
                match state
                    .session_manager
                    .update_cell_overlay(&session_id, cell_overlay)
                    .await
                {
                    Ok(_) => {
                        // Broadcast to all participants
                        state
                            .broadcast_to_session(
                                &session_id,
                                ServerMessage::PresenterCellOverlay {
                                    enabled,
                                    opacity,
                                    visible_cell_types,
                                },
                            )
                            .await;

                        let _ = tx
                            .send(ServerMessage::Ack {
                                ack_seq: seq,
                                status: crate::protocol::AckStatus::Ok,
                                reason: None,
                            })
                            .await;

                        debug!("Session {} cell overlay updated by presenter", session_id);
                    }
                    Err(e) => {
                        let _ = tx
                            .send(ServerMessage::Ack {
                                ack_seq: seq,
                                status: crate::protocol::AckStatus::Rejected,
                                reason: Some(e.to_string()),
                            })
                            .await;
                    }
                }
            } else {
                let _ = tx
                    .send(ServerMessage::Ack {
                        ack_seq: seq,
                        status: crate::protocol::AckStatus::Rejected,
                        reason: Some("Not in a session".to_string()),
                    })
                    .await;
            }
        }
    }
    // Note: The MessageMetricsGuard will record latency metrics when it's dropped here
}
