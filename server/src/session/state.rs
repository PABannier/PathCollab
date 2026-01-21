use crate::protocol::{
    CellOverlayState, Participant, ParticipantRole, SlideInfo, TissueOverlayState, Viewport,
};
use std::collections::HashMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Session ID: 10-character base32 string (lowercase, a-z + 2-7)
pub type SessionId = String;

/// Charset for session IDs: lowercase base32 (a-z, 2-7) to avoid 0/1 confusion
const SESSION_ID_CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz234567";
const SESSION_ID_LENGTH: usize = 10;

/// Generate a cryptographically random session ID
pub fn generate_session_id() -> SessionId {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut id = String::with_capacity(SESSION_ID_LENGTH);
    let hasher = RandomState::new();

    // Use multiple hash sources for randomness
    for i in 0..SESSION_ID_LENGTH {
        let mut h = hasher.build_hasher();
        h.write_usize(i);
        h.write_u128(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        );
        h.write_u128(Uuid::new_v4().as_u128());

        let idx = (h.finish() as usize) % SESSION_ID_CHARSET.len();
        id.push(SESSION_ID_CHARSET[idx] as char);
    }

    id
}

/// Generate a high-entropy secret (for join links and presenter keys)
pub fn generate_secret(bits: usize) -> String {
    let bytes_needed = bits.div_ceil(8);
    let mut secret = String::with_capacity(bytes_needed * 2);

    for _ in 0..bytes_needed {
        let byte = (Uuid::new_v4().as_u128() & 0xFF) as u8;
        secret.push_str(&format!("{:02x}", byte));
    }

    secret
}

/// Session state
#[derive(Debug, Clone)]
pub enum SessionState {
    Active,
    PresenterDisconnected { disconnect_at: u64 },
    Expired,
}

/// Full session data
#[derive(Debug)]
pub struct Session {
    // Identity
    pub id: SessionId,
    pub rev: u64,
    pub join_secret_hash: String,
    pub presenter_key_hash: String,

    // Safety controls
    pub locked: bool,

    // Timestamps
    pub created_at: u64,
    pub expires_at: u64,

    // Lifecycle
    pub state: SessionState,

    // Participants
    pub presenter_id: Uuid,
    pub participants: HashMap<Uuid, SessionParticipant>,

    // Content
    pub slide: SlideInfo,
    pub presenter_viewport: Viewport,

    // Cell overlay state (presenter-controlled)
    pub cell_overlay: Option<CellOverlayState>,
    pub tissue_overlay: Option<TissueOverlayState>,
}

/// Participant within a session (extended data)
#[derive(Debug, Clone)]
pub struct SessionParticipant {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub role: ParticipantRole,
    pub connected_at: u64,
    pub last_seen_at: u64,
    pub cursor_x: Option<f64>,
    pub cursor_y: Option<f64>,
    pub viewport: Option<Viewport>,
}

impl SessionParticipant {
    pub fn to_participant(&self) -> Participant {
        Participant {
            id: self.id,
            name: self.name.clone(),
            color: self.color.clone(),
            role: self.role,
            connected_at: self.connected_at,
        }
    }
}

/// Session configuration
pub struct SessionConfig {
    pub max_duration: Duration,
    pub presenter_grace_period: Duration,
    pub max_followers: usize,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            max_duration: Duration::from_secs(4 * 60 * 60), // 4 hours
            presenter_grace_period: Duration::from_secs(30),
            max_followers: 20,
        }
    }
}

/// Validation rules
pub fn validate_session_id(id: &str) -> bool {
    if id.len() != SESSION_ID_LENGTH {
        return false;
    }
    id.chars().all(|c| SESSION_ID_CHARSET.contains(&(c as u8)))
}

/// Get current timestamp in milliseconds
pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Random name generation for participants
const ADJECTIVES: &[&str] = &[
    "Swift", "Bright", "Calm", "Deft", "Eager", "Fair", "Gentle", "Happy", "Keen", "Lively",
    "Merry", "Noble", "Polite", "Quick", "Serene", "Tidy", "Vivid", "Warm", "Zesty", "Bold",
];

const ANIMALS: &[&str] = &[
    "Falcon", "Otter", "Panda", "Robin", "Tiger", "Whale", "Zebra", "Koala", "Eagle", "Dolphin",
    "Fox", "Owl", "Wolf", "Bear", "Hawk", "Seal", "Crane", "Deer", "Lynx", "Swan",
];

pub fn generate_participant_name() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let hasher = RandomState::new();
    let mut h = hasher.build_hasher();
    h.write_u128(Uuid::new_v4().as_u128());
    let hash = h.finish();

    let adj_idx = (hash as usize) % ADJECTIVES.len();
    let animal_idx = ((hash >> 32) as usize) % ANIMALS.len();

    format!("{} {}", ADJECTIVES[adj_idx], ANIMALS[animal_idx])
}

/// Participant color palette (12 visually distinct colors)
const PARTICIPANT_COLORS: &[&str] = &[
    "#3B82F6", // Blue
    "#EF4444", // Red
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#8B5CF6", // Violet
    "#EC4899", // Pink
    "#06B6D4", // Cyan
    "#F97316", // Orange
    "#6366F1", // Indigo
    "#14B8A6", // Teal
    "#A855F7", // Purple
    "#84CC16", // Lime
];

pub fn get_participant_color(index: usize) -> &'static str {
    PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_id_validation() {
        assert!(validate_session_id("abcd234567"));
        assert!(!validate_session_id("abcd23456")); // too short
        assert!(!validate_session_id("abcd2345670")); // too long
        assert!(!validate_session_id("ABCD234567")); // uppercase
        assert!(!validate_session_id("abcd234560")); // contains 0
        assert!(!validate_session_id("abcd234561")); // contains 1
        assert!(!validate_session_id("abcd234568")); // contains 8 (invalid)
        assert!(!validate_session_id("abcd234569")); // contains 9 (invalid)
    }
}
