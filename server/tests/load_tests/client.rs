//! WebSocket client wrapper for load testing
//!
//! Provides a high-level API for simulating PathCollab clients
//! with proper protocol handling and latency tracking.

#![allow(dead_code)]
#![allow(clippy::collapsible_if)]

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

/// Client message types (mirror of server protocol)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    CreateSession {
        slide_id: String,
        seq: u64,
    },
    JoinSession {
        session_id: String,
        join_secret: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_seen_rev: Option<u64>,
        seq: u64,
    },
    PresenterAuth {
        presenter_key: String,
        seq: u64,
    },
    CursorUpdate {
        x: f64,
        y: f64,
        seq: u64,
    },
    ViewportUpdate {
        center_x: f64,
        center_y: f64,
        zoom: f64,
        seq: u64,
    },
    Ping {
        seq: u64,
    },
}

/// Server message types (subset we care about for testing)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    SessionCreated {
        session: serde_json::Value,
        join_secret: String,
        presenter_key: String,
    },
    SessionJoined {
        session: serde_json::Value,
        you: serde_json::Value,
    },
    Ack {
        ack_seq: u64,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    PresenceDelta {
        changed: Vec<serde_json::Value>,
        removed: Vec<serde_json::Value>,
        server_ts: u64,
    },
    PresenterViewport {
        viewport: serde_json::Value,
    },
    SessionError {
        code: String,
        message: String,
    },
    Pong,
    #[serde(other)]
    Unknown,
}

/// WebSocket client for load testing
pub struct LoadTestClient {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    seq: AtomicU64,
    /// Timestamps of sent messages for latency calculation
    pending_acks: Arc<tokio::sync::RwLock<std::collections::HashMap<u64, Instant>>>,
    /// Session info after join/create
    pub session_id: Option<String>,
    pub join_secret: Option<String>,
    pub presenter_key: Option<String>,
}

impl LoadTestClient {
    /// Connect to WebSocket server
    pub async fn connect(url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (ws, _) = connect_async(url).await?;
        Ok(Self {
            ws,
            seq: AtomicU64::new(1),
            pending_acks: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
            session_id: None,
            join_secret: None,
            presenter_key: None,
        })
    }

    /// Get next sequence number
    fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst)
    }

    /// Send a message and track for latency measurement
    pub async fn send(
        &mut self,
        msg: ClientMessage,
    ) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let seq = match &msg {
            ClientMessage::CreateSession { seq, .. } => *seq,
            ClientMessage::JoinSession { seq, .. } => *seq,
            ClientMessage::PresenterAuth { seq, .. } => *seq,
            ClientMessage::CursorUpdate { seq, .. } => *seq,
            ClientMessage::ViewportUpdate { seq, .. } => *seq,
            ClientMessage::Ping { seq } => *seq,
        };

        // Track send time for latency calculation
        {
            let mut pending = self.pending_acks.write().await;
            pending.insert(seq, Instant::now());
        }

        let json = serde_json::to_string(&msg)?;
        self.ws.send(Message::Text(json.into())).await?;
        Ok(seq)
    }

    /// Create a new session
    pub async fn create_session(
        &mut self,
        slide_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let seq = self.next_seq();
        let msg = ClientMessage::CreateSession {
            slide_id: slide_id.to_string(),
            seq,
        };
        self.send(msg).await?;

        // Wait for SessionCreated response
        while let Some(result) = self.ws.next().await {
            let msg = result?;
            if let Message::Text(text) = msg {
                if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match server_msg {
                        ServerMessage::SessionCreated {
                            session,
                            join_secret,
                            presenter_key,
                        } => {
                            self.session_id = session
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            self.join_secret = Some(join_secret);
                            self.presenter_key = Some(presenter_key);
                            return Ok(());
                        }
                        ServerMessage::SessionError { code, message } => {
                            return Err(format!("Session error: {} - {}", code, message).into());
                        }
                        _ => {}
                    }
                }
            }
        }
        Err("Connection closed before SessionCreated received".into())
    }

    /// Join an existing session
    pub async fn join_session(
        &mut self,
        session_id: &str,
        join_secret: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let seq = self.next_seq();
        let msg = ClientMessage::JoinSession {
            session_id: session_id.to_string(),
            join_secret: join_secret.to_string(),
            last_seen_rev: None,
            seq,
        };
        self.send(msg).await?;

        // Wait for SessionJoined response
        while let Some(result) = self.ws.next().await {
            let msg = result?;
            if let Message::Text(text) = msg {
                if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match server_msg {
                        ServerMessage::SessionJoined { session, .. } => {
                            self.session_id = session
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            return Ok(());
                        }
                        ServerMessage::SessionError { code, message } => {
                            return Err(format!("Session error: {} - {}", code, message).into());
                        }
                        _ => {}
                    }
                }
            }
        }
        Err("Connection closed before SessionJoined received".into())
    }

    /// Send cursor update
    pub async fn send_cursor(
        &mut self,
        x: f64,
        y: f64,
    ) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let seq = self.next_seq();
        let msg = ClientMessage::CursorUpdate { x, y, seq };
        self.send(msg).await
    }

    /// Send viewport update
    pub async fn send_viewport(
        &mut self,
        center_x: f64,
        center_y: f64,
        zoom: f64,
    ) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let seq = self.next_seq();
        let msg = ClientMessage::ViewportUpdate {
            center_x,
            center_y,
            zoom,
            seq,
        };
        self.send(msg).await
    }

    /// Send ping
    pub async fn send_ping(&mut self) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
        let seq = self.next_seq();
        let msg = ClientMessage::Ping { seq };
        self.send(msg).await
    }

    /// Receive next message with optional timeout
    pub async fn recv_timeout(
        &mut self,
        timeout: Duration,
    ) -> Result<Option<ServerMessage>, Box<dyn std::error::Error + Send + Sync>> {
        match tokio::time::timeout(timeout, self.ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let server_msg: ServerMessage = serde_json::from_str(&text)?;
                Ok(Some(server_msg))
            }
            Ok(Some(Ok(_))) => Ok(None), // Non-text message
            Ok(Some(Err(e))) => Err(e.into()),
            Ok(None) => Ok(None), // Connection closed
            Err(_) => Ok(None),   // Timeout
        }
    }

    /// Process an ack and return the latency if tracked
    pub async fn process_ack(&mut self, ack_seq: u64) -> Option<Duration> {
        let mut pending = self.pending_acks.write().await;
        pending.remove(&ack_seq).map(|sent_at| sent_at.elapsed())
    }

    /// Close the connection
    pub async fn close(mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.ws.close(None).await?;
        Ok(())
    }
}

/// Spawn a client that sends updates at specified rates
pub async fn spawn_update_client(
    mut client: LoadTestClient,
    cursor_hz: u32,
    viewport_hz: u32,
    duration: Duration,
    results_tx: mpsc::Sender<ClientEvent>,
) {
    let cursor_interval = if cursor_hz > 0 {
        Duration::from_secs_f64(1.0 / cursor_hz as f64)
    } else {
        Duration::from_secs(3600) // Effectively disabled
    };

    let viewport_interval = if viewport_hz > 0 {
        Duration::from_secs_f64(1.0 / viewport_hz as f64)
    } else {
        Duration::from_secs(3600)
    };

    let start = Instant::now();
    let mut cursor_ticker = tokio::time::interval(cursor_interval);
    let mut viewport_ticker = tokio::time::interval(viewport_interval);
    let mut x = 0.5f64;
    let mut y = 0.5f64;

    loop {
        if start.elapsed() >= duration {
            break;
        }

        tokio::select! {
            _ = cursor_ticker.tick() => {
                // Simulate cursor movement
                x = (x + 0.001).min(1.0);
                y = (y + 0.001).min(1.0);
                if x >= 1.0 { x = 0.0; }
                if y >= 1.0 { y = 0.0; }

                match client.send_cursor(x, y).await {
                    Ok(seq) => {
                        let _ = results_tx.send(ClientEvent::MessageSent { seq, msg_type: "cursor" }).await;
                    }
                    Err(e) => {
                        let _ = results_tx.send(ClientEvent::Error { message: e.to_string() }).await;
                    }
                }
            }
            _ = viewport_ticker.tick() => {
                match client.send_viewport(0.5, 0.5, 1.0).await {
                    Ok(seq) => {
                        let _ = results_tx.send(ClientEvent::MessageSent { seq, msg_type: "viewport" }).await;
                    }
                    Err(e) => {
                        let _ = results_tx.send(ClientEvent::Error { message: e.to_string() }).await;
                    }
                }
            }
        }
    }

    let _ = client.close().await;
}

/// Events from client tasks
#[derive(Debug)]
pub enum ClientEvent {
    MessageSent {
        seq: u64,
        msg_type: &'static str,
    },
    MessageReceived {
        latency: Option<Duration>,
        msg_type: &'static str,
    },
    Error {
        message: String,
    },
}
