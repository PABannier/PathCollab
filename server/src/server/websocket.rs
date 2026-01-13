use crate::protocol::{ClientMessage, ServerMessage};
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Connection state for a single client
#[allow(dead_code)] // Fields used when session management is fully integrated
pub struct Connection {
    pub id: Uuid,
    pub session_id: Option<String>,
    pub participant_id: Option<Uuid>,
    pub is_presenter: bool,
    pub last_ping: Instant,
    pub sender: mpsc::Sender<ServerMessage>,
}

/// Global connection registry
pub type ConnectionRegistry = Arc<RwLock<HashMap<Uuid, Connection>>>;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub connections: ConnectionRegistry,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Configuration for WebSocket connections
#[allow(dead_code)] // Fields used when configuration is fully integrated
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

            // Send ping (client should respond with pong)
            if ping_tx.send(ServerMessage::Pong).await.is_err() {
                break;
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
                    Message::Binary(_) => {
                        // Binary messages (MessagePack) - to be implemented
                        debug!("Received binary message");
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

    // Cleanup
    ping_task.abort();
    send_task.abort();

    // Remove from registry
    {
        let mut connections = state.connections.write().await;
        connections.remove(&connection_id);
    }

    info!("WebSocket connection closed: {}", connection_id);
}

/// Handle a parsed client message
async fn handle_client_message(
    msg: ClientMessage,
    connection_id: Uuid,
    state: &AppState,
    tx: &mpsc::Sender<ServerMessage>,
) {
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
            // TODO: Implement session creation
            info!(
                "Create session request from {}: slide={}",
                connection_id, slide_id
            );
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Ok,
                    reason: Some("Session creation not yet implemented".to_string()),
                })
                .await;
        }
        ClientMessage::JoinSession {
            session_id,
            join_secret: _,
            last_seen_rev: _,
            seq,
        } => {
            // TODO: Implement session joining
            info!(
                "Join session request from {}: session={}",
                connection_id, session_id
            );
            let _ = tx
                .send(ServerMessage::SessionError {
                    code: crate::protocol::ErrorCode::SessionNotFound,
                    message: "Session not found".to_string(),
                })
                .await;
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Rejected,
                    reason: Some("Session not found".to_string()),
                })
                .await;
        }
        ClientMessage::CursorUpdate { x, y, seq: _ } => {
            // TODO: Broadcast to session participants
            debug!("Cursor update from {}: ({}, {})", connection_id, x, y);
        }
        ClientMessage::ViewportUpdate {
            center_x,
            center_y,
            zoom,
            seq: _,
        } => {
            // TODO: Broadcast to session participants
            debug!(
                "Viewport update from {}: center=({}, {}), zoom={}",
                connection_id, center_x, center_y, zoom
            );
        }
        ClientMessage::PresenterAuth {
            presenter_key: _,
            seq,
        } => {
            // TODO: Implement presenter authentication
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Rejected,
                    reason: Some("Not in a session".to_string()),
                })
                .await;
        }
        ClientMessage::LayerUpdate { visibility: _, seq } => {
            // TODO: Broadcast layer state to session
            let connections = state.connections.read().await;
            if let Some(conn) = connections.get(&connection_id)
                && !conn.is_presenter
            {
                let _ = tx
                    .send(ServerMessage::Ack {
                        ack_seq: seq,
                        status: crate::protocol::AckStatus::Rejected,
                        reason: Some("Only presenter can update layers".to_string()),
                    })
                    .await;
                return;
            }
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Ok,
                    reason: None,
                })
                .await;
        }
        ClientMessage::SnapToPresenter { seq } => {
            let _ = tx
                .send(ServerMessage::Ack {
                    ack_seq: seq,
                    status: crate::protocol::AckStatus::Ok,
                    reason: None,
                })
                .await;
        }
    }
}
