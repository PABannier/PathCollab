use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Client to Server messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Join an existing session
    JoinSession {
        session_id: String,
        join_secret: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_seen_rev: Option<u64>,
        seq: u64,
    },
    /// Create a new session
    CreateSession { slide_id: String, seq: u64 },
    /// Authenticate as presenter
    PresenterAuth { presenter_key: String, seq: u64 },
    /// Update cursor position
    CursorUpdate { x: f64, y: f64, seq: u64 },
    /// Update viewport (presenter: 10Hz, follower: 2Hz)
    ViewportUpdate {
        center_x: f64,
        center_y: f64,
        zoom: f64,
        seq: u64,
    },
    /// Update layer visibility (presenter only)
    LayerUpdate {
        visibility: LayerVisibility,
        seq: u64,
    },
    /// Snap to presenter viewport
    SnapToPresenter { seq: u64 },
    /// Change slide (presenter only)
    ChangeSlide { slide_id: String, seq: u64 },
    /// Ping for keepalive
    Ping { seq: u64 },
}

/// Server to Client messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Session was created successfully (includes secrets for presenter)
    SessionCreated {
        session: SessionSnapshot,
        join_secret: String,
        presenter_key: String,
    },
    /// Successfully joined a session
    SessionJoined {
        session: SessionSnapshot,
        you: Participant,
    },
    /// QoS profile for this client
    QosProfile { profile: QosProfileData },
    /// Acknowledgment of client action
    Ack {
        ack_seq: u64,
        status: AckStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Session error
    SessionError { code: ErrorCode, message: String },
    /// Session has ended
    SessionEnded { reason: SessionEndReason },
    /// A participant joined
    ParticipantJoined { participant: Participant },
    /// A participant left
    ParticipantLeft { participant_id: Uuid },
    /// Presence update (cursor positions)
    PresenceDelta {
        changed: Vec<CursorWithParticipant>,
        removed: Vec<Uuid>,
        server_ts: u64,
    },
    /// Presenter viewport update
    PresenterViewport { viewport: Viewport },
    /// Layer state update
    LayerState { visibility: LayerVisibility },
    /// Overlay loaded notification
    OverlayLoaded {
        overlay_id: String,
        manifest: OverlayManifest,
    },
    /// Slide changed notification (broadcast to all participants)
    SlideChanged { slide: SlideInfo },
    /// Ping for keepalive (server to client)
    Ping,
    /// Pong response (to client's Ping)
    Pong,
}

/// Overlay manifest sent to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayManifest {
    pub overlay_id: String,
    pub content_sha256: String,
    pub raster_base_url: String,
    pub vec_base_url: String,
    pub tile_size: u32,
    pub levels: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AckStatus {
    Ok,
    Rejected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    SessionNotFound,
    SessionFull,
    SessionExpired,
    InvalidSlide,
    InvalidMessage,
    Unauthorized,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionEndReason {
    Expired,
    PresenterLeft,
}

/// Session snapshot for state transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: String,
    pub rev: u64,
    pub slide: SlideInfo,
    pub presenter: Participant,
    pub followers: Vec<Participant>,
    pub layer_visibility: LayerVisibility,
    pub presenter_viewport: Viewport,
}

/// Participant info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub role: ParticipantRole,
    pub connected_at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Presenter,
    Follower,
}

/// Slide information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideInfo {
    pub id: String,
    pub name: String,
    pub width: u64,
    pub height: u64,
    pub tile_size: u32,
    pub num_levels: u32,
    pub tile_url_template: String,
    #[serde(default)]
    pub has_overlay: bool,
}

/// Viewport state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub center_x: f64,
    pub center_y: f64,
    pub zoom: f64,
    pub timestamp: u64,
}

/// Layer visibility settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerVisibility {
    pub tissue_heatmap_visible: bool,
    pub tissue_heatmap_opacity: f32,
    pub tissue_classes_visible: Vec<u8>,
    pub cell_polygons_visible: bool,
    pub cell_polygons_opacity: f32,
    pub cell_classes_visible: Vec<u8>,
    pub cell_hover_enabled: bool,
}

impl Default for LayerVisibility {
    fn default() -> Self {
        Self {
            tissue_heatmap_visible: true,
            tissue_heatmap_opacity: 0.5,
            tissue_classes_visible: vec![0, 1, 2, 3, 4, 5, 6, 7],
            cell_polygons_visible: true,
            cell_polygons_opacity: 0.7,
            cell_classes_visible: (0..15).collect(),
            cell_hover_enabled: true,
        }
    }
}

/// Cursor with participant info for presence updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorWithParticipant {
    pub participant_id: Uuid,
    pub name: String,
    pub color: String,
    pub is_presenter: bool,
    pub x: f64,
    pub y: f64,
}

/// QoS profile data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QosProfileData {
    pub cursor_send_hz: u32,
    pub viewport_send_hz: u32,
    pub overlay_batch_kb: u32,
    pub overlay_mode: OverlayMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OverlayMode {
    RasterOnly,
    Points,
    Polygons,
}

impl Default for QosProfileData {
    fn default() -> Self {
        Self {
            cursor_send_hz: 30,
            viewport_send_hz: 10,
            overlay_batch_kb: 256,
            overlay_mode: OverlayMode::Polygons,
        }
    }
}

impl ClientMessage {
    /// Get the message type name for metrics
    pub fn message_type(&self) -> &'static str {
        match self {
            ClientMessage::JoinSession { .. } => "join_session",
            ClientMessage::CreateSession { .. } => "create_session",
            ClientMessage::PresenterAuth { .. } => "presenter_auth",
            ClientMessage::CursorUpdate { .. } => "cursor_update",
            ClientMessage::ViewportUpdate { .. } => "viewport_update",
            ClientMessage::LayerUpdate { .. } => "layer_update",
            ClientMessage::SnapToPresenter { .. } => "snap_to_presenter",
            ClientMessage::ChangeSlide { .. } => "change_slide",
            ClientMessage::Ping { .. } => "ping",
        }
    }
}

impl ServerMessage {
    /// Get the message type name for metrics
    pub fn message_type(&self) -> &'static str {
        match self {
            ServerMessage::SessionCreated { .. } => "session_created",
            ServerMessage::SessionJoined { .. } => "session_joined",
            ServerMessage::QosProfile { .. } => "qos_profile",
            ServerMessage::Ack { .. } => "ack",
            ServerMessage::SessionError { .. } => "session_error",
            ServerMessage::SessionEnded { .. } => "session_ended",
            ServerMessage::ParticipantJoined { .. } => "participant_joined",
            ServerMessage::ParticipantLeft { .. } => "participant_left",
            ServerMessage::PresenceDelta { .. } => "presence_delta",
            ServerMessage::PresenterViewport { .. } => "presenter_viewport",
            ServerMessage::LayerState { .. } => "layer_state",
            ServerMessage::OverlayLoaded { .. } => "overlay_loaded",
            ServerMessage::SlideChanged { .. } => "slide_changed",
            ServerMessage::Ping => "ping",
            ServerMessage::Pong => "pong",
        }
    }
}
