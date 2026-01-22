//! WebSocket client wrapper for load testing
//!
//! Provides a high-level API for simulating PathCollab clients
//! with proper protocol handling and latency tracking.

#![allow(clippy::collapsible_if)]

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::net::TcpStream;
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
            session_id: None,
            join_secret: None,
            presenter_key: None,
        })
    }

    /// Get next sequence number
    fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst)
    }

    /// Send a message and return the sequence number
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

    /// Close the connection
    pub async fn close(mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.ws.close(None).await?;
        Ok(())
    }
}

/// Slide info returned from the API
#[derive(Debug, Clone, Deserialize)]
pub struct SlideInfo {
    pub id: String,
    pub name: String,
    pub width: u64,
    pub height: u64,
}

/// Fetch the first available slide from the server
///
/// This allows load tests to work with real slides instead of hardcoded test slides.
pub async fn fetch_first_slide(
    http_base_url: &str,
) -> Result<SlideInfo, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("{}/api/slides", http_base_url);

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch slides: HTTP {}", resp.status()).into());
    }

    let slides: Vec<SlideInfo> = resp.json().await?;

    slides
        .into_iter()
        .next()
        .ok_or_else(|| "No slides available on server. Make sure slides are configured.".into())
}
