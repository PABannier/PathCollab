use crate::protocol::{
    LayerVisibility, Participant, ParticipantRole, SessionSnapshot, SlideInfo, Viewport,
};
use crate::session::state::{
    Session, SessionConfig, SessionId, SessionParticipant, SessionState, generate_participant_name,
    generate_secret, generate_session_id, get_participant_color, now_millis,
};
use metrics::{counter, histogram};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Session manager errors
#[derive(Debug, Error)]
#[allow(dead_code)] // Variants used when session management is fully integrated
pub enum SessionError {
    #[error("Session not found: {0}")]
    NotFound(SessionId),

    #[error("Session is full (max {0} followers)")]
    SessionFull(usize),

    #[error("Session has expired")]
    SessionExpired,

    #[error("Invalid join secret")]
    InvalidJoinSecret,

    #[error("Invalid presenter key")]
    InvalidPresenterKey,

    #[error("Session is locked")]
    SessionLocked,

    #[error("Not authorized as presenter")]
    NotPresenter,

    #[error("Participant not found: {0}")]
    ParticipantNotFound(Uuid),
}

/// Session manager: handles all session CRUD operations
#[allow(dead_code)] // Used when session management is fully integrated
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<SessionId, Session>>>,
    config: SessionConfig,
}

#[allow(dead_code)] // Methods used when session management is fully integrated
impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            config: SessionConfig::default(),
        }
    }

    pub fn with_config(config: SessionConfig) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Create a new session
    pub async fn create_session(
        &self,
        slide: SlideInfo,
        presenter_connection_id: Uuid,
    ) -> Result<(Session, String, String), SessionError> {
        let start = Instant::now();
        counter!("pathcollab_sessions_created_total").increment(1);

        let session_id = generate_session_id();
        let join_secret = generate_secret(128);
        let presenter_key = generate_secret(192);

        // Hash secrets (simple hash for now - use argon2 in production)
        let join_secret_hash = hash_secret(&join_secret);
        let presenter_key_hash = hash_secret(&presenter_key);

        let now = now_millis();
        let expires_at = now + self.config.max_duration.as_millis() as u64;

        // Create presenter participant
        let presenter_id = Uuid::new_v4();
        let presenter = SessionParticipant {
            id: presenter_id,
            name: generate_participant_name(),
            color: get_participant_color(0).to_string(),
            role: ParticipantRole::Presenter,
            connected_at: now,
            last_seen_at: now,
            cursor_x: None,
            cursor_y: None,
            viewport: None,
        };

        let mut participants = HashMap::new();
        participants.insert(presenter_id, presenter);

        let session = Session {
            id: session_id.clone(),
            rev: 1,
            join_secret_hash,
            presenter_key_hash,
            locked: false,
            created_at: now,
            expires_at,
            state: SessionState::Active,
            presenter_id,
            participants,
            slide,
            layer_visibility: LayerVisibility::default(),
            presenter_viewport: Viewport {
                center_x: 0.5,
                center_y: 0.5,
                zoom: 1.0,
                timestamp: now,
            },
        };

        info!(
            "Created session {} for presenter {}",
            session_id, presenter_connection_id
        );

        // Store session and clone it before releasing lock
        let session = {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
            // Clone immediately while we still hold the lock
            sessions.get(&session_id).cloned()
        };

        // The session should always exist since we just inserted it
        let session = session.ok_or_else(|| {
            error!(
                "Session {} disappeared immediately after creation",
                session_id
            );
            SessionError::NotFound(session_id)
        })?;

        histogram!("pathcollab_session_create_duration_seconds").record(start.elapsed());
        Ok((session, join_secret, presenter_key))
    }

    /// Join an existing session
    pub async fn join_session(
        &self,
        session_id: &str,
        join_secret: &str,
    ) -> Result<(SessionSnapshot, Participant), SessionError> {
        let start = Instant::now();
        counter!("pathcollab_session_joins_total").increment(1);

        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        // Check if session is expired
        if matches!(session.state, SessionState::Expired) {
            return Err(SessionError::SessionExpired);
        }

        // Check if session is locked
        if session.locked {
            return Err(SessionError::SessionLocked);
        }

        // Verify join secret
        if !verify_secret(join_secret, &session.join_secret_hash) {
            return Err(SessionError::InvalidJoinSecret);
        }

        // Check if session is full
        let follower_count = session
            .participants
            .values()
            .filter(|p| p.role == ParticipantRole::Follower)
            .count();
        if follower_count >= self.config.max_followers {
            return Err(SessionError::SessionFull(self.config.max_followers));
        }

        // Create new follower
        let now = now_millis();
        let participant_id = Uuid::new_v4();
        let color_index = session.participants.len();

        let participant = SessionParticipant {
            id: participant_id,
            name: generate_participant_name(),
            color: get_participant_color(color_index).to_string(),
            role: ParticipantRole::Follower,
            connected_at: now,
            last_seen_at: now,
            cursor_x: None,
            cursor_y: None,
            viewport: None,
        };

        let participant_data = participant.to_participant();
        session.participants.insert(participant_id, participant);
        session.rev += 1;

        info!(
            "Participant {} joined session {}",
            participant_id, session_id
        );

        let snapshot = create_session_snapshot(session);

        // Record participants count in this session
        histogram!("pathcollab_session_participants").record(session.participants.len() as f64);
        histogram!("pathcollab_session_join_duration_seconds").record(start.elapsed());

        Ok((snapshot, participant_data))
    }

    /// Authenticate as presenter
    pub async fn authenticate_presenter(
        &self,
        session_id: &str,
        presenter_key: &str,
    ) -> Result<(), SessionError> {
        let sessions = self.sessions.read().await;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        if !verify_secret(presenter_key, &session.presenter_key_hash) {
            return Err(SessionError::InvalidPresenterKey);
        }

        Ok(())
    }

    /// Get session snapshot
    pub async fn get_session(&self, session_id: &str) -> Result<SessionSnapshot, SessionError> {
        let sessions = self.sessions.read().await;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        Ok(create_session_snapshot(session))
    }

    /// Update presenter viewport
    pub async fn update_presenter_viewport(
        &self,
        session_id: &str,
        viewport: Viewport,
    ) -> Result<u64, SessionError> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        session.presenter_viewport = viewport;
        session.rev += 1;

        Ok(session.rev)
    }

    /// Update layer visibility
    pub async fn update_layer_visibility(
        &self,
        session_id: &str,
        visibility: LayerVisibility,
    ) -> Result<u64, SessionError> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        session.layer_visibility = visibility;
        session.rev += 1;

        Ok(session.rev)
    }

    /// Change the slide for a session (presenter only)
    pub async fn change_slide(
        &self,
        session_id: &str,
        slide: SlideInfo,
    ) -> Result<SlideInfo, SessionError> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        session.slide = slide.clone();
        session.rev += 1;

        // Reset viewport to center when slide changes
        session.presenter_viewport = Viewport {
            center_x: 0.5,
            center_y: 0.5,
            zoom: 1.0,
            timestamp: now_millis(),
        };

        info!("Session {} slide changed to {}", session_id, slide.id);

        Ok(slide)
    }

    /// Update participant cursor
    pub async fn update_cursor(
        &self,
        session_id: &str,
        participant_id: Uuid,
        x: f64,
        y: f64,
    ) -> Result<(), SessionError> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        let participant = session
            .participants
            .get_mut(&participant_id)
            .ok_or(SessionError::ParticipantNotFound(participant_id))?;

        participant.cursor_x = Some(x);
        participant.cursor_y = Some(y);
        participant.last_seen_at = now_millis();

        Ok(())
    }

    /// Remove participant from session
    pub async fn remove_participant(
        &self,
        session_id: &str,
        participant_id: Uuid,
    ) -> Result<bool, SessionError> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| SessionError::NotFound(session_id.to_string()))?;

        let was_presenter = session.presenter_id == participant_id;

        session.participants.remove(&participant_id);
        session.rev += 1;

        // Track participant leaves
        counter!("pathcollab_session_leaves_total", "role" => if was_presenter { "presenter" } else { "follower" }).increment(1);

        if was_presenter {
            // Start presenter grace period
            session.state = SessionState::PresenterDisconnected {
                disconnect_at: now_millis(),
            };
            warn!(
                "Presenter left session {}, starting grace period",
                session_id
            );
        }

        debug!(
            "Participant {} removed from session {}",
            participant_id, session_id
        );

        Ok(was_presenter)
    }

    /// Clean up expired sessions
    pub async fn cleanup_expired(&self) {
        let now = now_millis();
        let mut sessions = self.sessions.write().await;

        let expired: Vec<SessionId> = sessions
            .iter()
            .filter(|(_, session)| {
                session.expires_at < now
                    || matches!(
                        session.state,
                        SessionState::PresenterDisconnected { disconnect_at }
                            if now - disconnect_at > self.config.presenter_grace_period.as_millis() as u64
                    )
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in expired {
            info!("Removing expired session: {}", id);
            sessions.remove(&id);
            counter!("pathcollab_sessions_expired_total").increment(1);
        }
    }

    /// Get count of active sessions
    pub async fn session_count_async(&self) -> usize {
        let sessions = self.sessions.read().await;
        sessions.len()
    }

    /// Get count of active sessions (blocking version for sync contexts)
    pub fn session_count(&self) -> usize {
        let sessions = self.sessions.blocking_read();
        sessions.len()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Clone implementation for Session (needed for returning data)
impl Clone for Session {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            rev: self.rev,
            join_secret_hash: self.join_secret_hash.clone(),
            presenter_key_hash: self.presenter_key_hash.clone(),
            locked: self.locked,
            created_at: self.created_at,
            expires_at: self.expires_at,
            state: self.state.clone(),
            presenter_id: self.presenter_id,
            participants: self.participants.clone(),
            slide: self.slide.clone(),
            layer_visibility: self.layer_visibility.clone(),
            presenter_viewport: self.presenter_viewport.clone(),
        }
    }
}

/// Create session snapshot from session
fn create_session_snapshot(session: &Session) -> SessionSnapshot {
    let presenter = session
        .participants
        .get(&session.presenter_id)
        .map(|p| p.to_participant())
        .unwrap_or_else(|| Participant {
            id: session.presenter_id,
            name: "Unknown".to_string(),
            color: "#888888".to_string(),
            role: ParticipantRole::Presenter,
            connected_at: session.created_at,
        });

    let followers: Vec<Participant> = session
        .participants
        .values()
        .filter(|p| p.role == ParticipantRole::Follower)
        .map(|p| p.to_participant())
        .collect();

    SessionSnapshot {
        id: session.id.clone(),
        rev: session.rev,
        slide: session.slide.clone(),
        presenter,
        followers,
        layer_visibility: session.layer_visibility.clone(),
        presenter_viewport: session.presenter_viewport.clone(),
    }
}

/// Hash secrets using SHA256 for secure comparison
fn hash_secret(secret: &str) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let result = hasher.finalize();
    // Return hex-encoded hash
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Verify secret against hash
fn verify_secret(secret: &str, hash: &str) -> bool {
    hash_secret(secret) == hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn test_slide() -> SlideInfo {
        SlideInfo {
            id: "test".to_string(),
            name: "Test Slide".to_string(),
            width: 100000,
            height: 100000,
            tile_size: 256,
            num_levels: 10,
            tile_url_template: "/tile/{level}/{x}/{y}".to_string(),
            has_overlay: false,
        }
    }

    #[tokio::test]
    async fn test_create_session() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let result = manager.create_session(test_slide(), presenter_id).await;
        assert!(result.is_ok());

        let (session, join_secret, presenter_key) = result.unwrap();
        assert_eq!(session.id.len(), 10);
        assert!(!join_secret.is_empty());
        assert!(!presenter_key.is_empty());
    }

    #[tokio::test]
    async fn test_join_session() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, join_secret, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .unwrap();

        let result = manager.join_session(&session.id, &join_secret).await;
        assert!(result.is_ok());

        let (snapshot, participant) = result.unwrap();
        assert_eq!(snapshot.followers.len(), 1);
        assert_eq!(participant.role, ParticipantRole::Follower);
    }

    #[tokio::test]
    async fn test_invalid_join_secret() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .unwrap();

        let result = manager.join_session(&session.id, "invalid").await;
        assert!(matches!(result, Err(SessionError::InvalidJoinSecret)));
    }

    #[tokio::test]
    async fn test_cleanup_expired_sessions() {
        let config = SessionConfig {
            max_duration: Duration::from_millis(1),
            presenter_grace_period: Duration::from_secs(1),
            max_followers: 20,
        };
        let manager = SessionManager::with_config(config);

        manager
            .create_session(test_slide(), Uuid::new_v4())
            .await
            .unwrap();

        tokio::time::sleep(Duration::from_millis(5)).await;
        manager.cleanup_expired().await;

        assert_eq!(manager.session_count_async().await, 0);
    }

    // ========================================================================
    // Phase 1 Specification Tests (from IMPLEMENTATION_PLAN.md)
    // Tests verify requirements, not implementation. Failures indicate bugs.
    // ========================================================================

    /// Phase 1 spec: Session ID is 10-character base32 (lowercase, avoids ambiguous chars)
    /// Pattern: /^[a-z2-7]{10}$/
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.1, Appendix C
    #[tokio::test]
    async fn test_session_id_is_10_char_base32() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Phase 1 spec: Session ID must be exactly 10 characters
        assert_eq!(
            session.id.len(),
            10,
            "Session ID must be exactly 10 characters (Phase 1 spec)"
        );

        // Phase 1 spec: Session ID must match pattern /^[a-z2-7]{10}$/
        // This excludes digits 0/1 and 8/9 (base32 alphabet a-z, 2-7)
        let valid_chars: &[char] = &[
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q',
            'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '2', '3', '4', '5', '6', '7',
        ];

        for c in session.id.chars() {
            assert!(
                valid_chars.contains(&c),
                "Session ID contains invalid character '{}'. Must be lowercase base32 (a-z, 2-7)",
                c
            );
        }

        // Verify it does NOT contain disallowed digits (0, 1, 8, 9)
        for c in ['0', '1', '8', '9'] {
            assert!(
                !session.id.contains(c),
                "Session ID must not contain ambiguous character '{}'",
                c
            );
        }
    }

    /// Phase 1 spec: join_secret has 128+ bits of entropy
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.6 (JOIN_SECRET_MIN_BITS)
    #[tokio::test]
    async fn test_join_secret_has_128_bits_entropy() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (_, join_secret, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // 128 bits = 16 bytes = 32 hex characters
        // The secret should be at least 32 characters of hex
        let min_length = 32; // 128 bits / 4 bits per hex char
        assert!(
            join_secret.len() >= min_length,
            "join_secret must have at least 128 bits of entropy (32 hex chars). Got {} chars",
            join_secret.len()
        );

        // Verify it's valid hex
        assert!(
            join_secret.chars().all(|c| c.is_ascii_hexdigit()),
            "join_secret must be valid hexadecimal"
        );
    }

    /// Phase 1 spec: presenter_key has 192+ bits of entropy
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.6 (PRESENTER_KEY_MIN_BITS)
    #[tokio::test]
    async fn test_presenter_key_has_192_bits_entropy() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (_, _, presenter_key) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // 192 bits = 24 bytes = 48 hex characters
        let min_length = 48; // 192 bits / 4 bits per hex char
        assert!(
            presenter_key.len() >= min_length,
            "presenter_key must have at least 192 bits of entropy (48 hex chars). Got {} chars",
            presenter_key.len()
        );

        // Verify it's valid hex
        assert!(
            presenter_key.chars().all(|c| c.is_ascii_hexdigit()),
            "presenter_key must be valid hexadecimal"
        );
    }

    /// Phase 1 spec: Session expires after 4 hours (SESSION_MAX_DURATION_MS = 14,400,000)
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.6
    #[tokio::test]
    async fn test_session_expires_after_4_hours() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Phase 1 spec: expires_at = created_at + 4 hours (14,400,000 ms)
        let expected_duration_ms: u64 = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
        let actual_duration_ms = session.expires_at - session.created_at;

        assert_eq!(
            actual_duration_ms, expected_duration_ms,
            "Session must expire after exactly 4 hours (14,400,000 ms). Got {} ms",
            actual_duration_ms
        );
    }

    /// Phase 1 spec: Max 20 followers per session (MAX_FOLLOWERS = 20)
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.6
    #[tokio::test]
    async fn test_session_rejects_21st_follower() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, join_secret, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Join 20 followers (the max allowed)
        for i in 0..20 {
            let result = manager.join_session(&session.id, &join_secret).await;
            assert!(
                result.is_ok(),
                "Follower {} should be able to join (max is 20)",
                i + 1
            );
        }

        // The 21st follower should be rejected
        let result = manager.join_session(&session.id, &join_secret).await;
        assert!(
            matches!(result, Err(SessionError::SessionFull(20))),
            "21st follower must be rejected with SessionFull error. Got: {:?}",
            result
        );
    }

    /// Phase 1 spec: Participant colors from 12-color palette
    /// Reference: IMPLEMENTATION_PLAN.md Appendix A
    #[tokio::test]
    async fn test_participant_colors_from_palette() {
        use crate::session::state::get_participant_color;

        // Phase 1 spec: 12-color palette (Appendix A)
        let expected_colors = [
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

        for (i, expected) in expected_colors.iter().enumerate() {
            let actual = get_participant_color(i);
            assert_eq!(
                actual, *expected,
                "Color at index {} must be {} (Phase 1 spec Appendix A). Got: {}",
                i, expected, actual
            );
        }
    }

    /// Phase 1 spec: Colors cycle through palette as participants join
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.1
    #[tokio::test]
    async fn test_colors_cycle_through_palette() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, join_secret, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Presenter gets first color
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(
            snapshot.presenter.color, "#3B82F6",
            "Presenter must get first color (Blue)"
        );

        // Add followers and check they get sequential colors
        let expected_follower_colors = [
            "#EF4444", // Follower 1: Red
            "#10B981", // Follower 2: Emerald
            "#F59E0B", // Follower 3: Amber
        ];

        for (i, expected_color) in expected_follower_colors.iter().enumerate() {
            let (snapshot, participant) = manager
                .join_session(&session.id, &join_secret)
                .await
                .expect("Join should succeed");

            assert_eq!(
                participant.color,
                *expected_color,
                "Follower {} must get color {} (cycling through palette). Got: {}",
                i + 1,
                expected_color,
                participant.color
            );

            // Also verify in snapshot
            let follower_in_snapshot = snapshot.followers.iter().find(|f| f.id == participant.id);
            assert!(
                follower_in_snapshot.is_some(),
                "Follower must appear in snapshot"
            );
            assert_eq!(
                follower_in_snapshot.unwrap().color,
                *expected_color,
                "Follower color in snapshot must match"
            );
        }
    }

    /// Phase 1 spec: Participant names are adjective + animal format
    /// Reference: IMPLEMENTATION_PLAN.md Appendix B
    #[tokio::test]
    async fn test_participant_names_adjective_animal_format() {
        use crate::session::state::generate_participant_name;

        // Phase 1 spec: Name format is "{Adjective} {Animal}" (Appendix B)
        let adjectives = [
            "Swift", "Bright", "Calm", "Deft", "Eager", "Fair", "Gentle", "Happy", "Keen",
            "Lively", "Merry", "Noble", "Polite", "Quick", "Serene", "Tidy", "Vivid", "Warm",
            "Zesty", "Bold",
        ];
        let animals = [
            "Falcon", "Otter", "Panda", "Robin", "Tiger", "Whale", "Zebra", "Koala", "Eagle",
            "Dolphin", "Fox", "Owl", "Wolf", "Bear", "Hawk", "Seal", "Crane", "Deer", "Lynx",
            "Swan",
        ];

        // Generate several names and verify format
        for _ in 0..10 {
            let name = generate_participant_name();
            let parts: Vec<&str> = name.split(' ').collect();

            assert_eq!(
                parts.len(),
                2,
                "Name must be two words (adjective + animal). Got: '{}'",
                name
            );

            assert!(
                adjectives.contains(&parts[0]),
                "First word must be from adjective list. Got: '{}' in '{}'",
                parts[0],
                name
            );

            assert!(
                animals.contains(&parts[1]),
                "Second word must be from animal list. Got: '{}' in '{}'",
                parts[1],
                name
            );
        }
    }

    /// Phase 1 spec: Presenter grace period is 30 seconds
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.6 (PRESENTER_GRACE_PERIOD_MS)
    #[tokio::test]
    async fn test_presenter_grace_period_is_30_seconds() {
        let config = SessionConfig::default();

        // Phase 1 spec: PRESENTER_GRACE_PERIOD_MS = 30 * 1000 (30 seconds)
        let expected_grace_period_ms: u64 = 30 * 1000;
        let actual_grace_period_ms = config.presenter_grace_period.as_millis() as u64;

        assert_eq!(
            actual_grace_period_ms, expected_grace_period_ms,
            "Presenter grace period must be 30 seconds (30,000 ms). Got: {} ms",
            actual_grace_period_ms
        );
    }

    /// Test: Presenter can change slides mid-session
    /// When presenter changes slides, all followers should receive the new slide info
    #[tokio::test]
    async fn test_change_slide_updates_session() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session with initial slide
        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Verify initial slide
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(snapshot.slide.id, "test");
        assert_eq!(snapshot.slide.name, "Test Slide");

        // Create a new slide to switch to
        let new_slide = SlideInfo {
            id: "new_slide".to_string(),
            name: "New Slide".to_string(),
            width: 200000,
            height: 150000,
            tile_size: 512,
            num_levels: 12,
            tile_url_template: "/tile/{level}/{x}/{y}".to_string(),
            has_overlay: false,
        };

        // Change the slide
        let result = manager.change_slide(&session.id, new_slide.clone()).await;
        assert!(result.is_ok(), "Slide change should succeed");

        // Verify the slide was updated
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(snapshot.slide.id, "new_slide", "Slide ID should be updated");
        assert_eq!(
            snapshot.slide.name, "New Slide",
            "Slide name should be updated"
        );
        assert_eq!(
            snapshot.slide.width, 200000,
            "Slide width should be updated"
        );
        assert_eq!(
            snapshot.slide.height, 150000,
            "Slide height should be updated"
        );

        // Verify viewport was reset to center
        assert_eq!(
            snapshot.presenter_viewport.center_x, 0.5,
            "Viewport center_x should reset to 0.5"
        );
        assert_eq!(
            snapshot.presenter_viewport.center_y, 0.5,
            "Viewport center_y should reset to 0.5"
        );
        assert_eq!(
            snapshot.presenter_viewport.zoom, 1.0,
            "Viewport zoom should reset to 1.0"
        );
    }

    /// Test: Slide change increments session revision
    /// This ensures followers can detect state changes
    #[tokio::test]
    async fn test_change_slide_increments_revision() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        let initial_rev = manager.get_session(&session.id).await.unwrap().rev;

        // Change slide
        let new_slide = SlideInfo {
            id: "another_slide".to_string(),
            name: "Another Slide".to_string(),
            width: 50000,
            height: 50000,
            tile_size: 256,
            num_levels: 8,
            tile_url_template: "/tile/{level}/{x}/{y}".to_string(),
            has_overlay: false,
        };

        manager
            .change_slide(&session.id, new_slide)
            .await
            .expect("Slide change should succeed");

        let new_rev = manager.get_session(&session.id).await.unwrap().rev;
        assert!(
            new_rev > initial_rev,
            "Session revision should increment after slide change"
        );
    }

    /// Test: Slide change on non-existent session returns error
    #[tokio::test]
    async fn test_change_slide_invalid_session() {
        let manager = SessionManager::new();

        let new_slide = SlideInfo {
            id: "test".to_string(),
            name: "Test".to_string(),
            width: 1000,
            height: 1000,
            tile_size: 256,
            num_levels: 4,
            tile_url_template: "/tile/{level}/{x}/{y}".to_string(),
            has_overlay: false,
        };

        let result = manager.change_slide("nonexistent", new_slide).await;
        assert!(
            matches!(result, Err(SessionError::NotFound(_))),
            "Should return NotFound error for invalid session"
        );
    }

    /// Phase 1 spec: Session state transitions correctly
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.1
    #[tokio::test]
    async fn test_session_state_transitions() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let (session, _, _) = manager
            .create_session(test_slide(), presenter_id)
            .await
            .expect("Session creation should succeed");

        // Initial state should be Active
        let snapshot = manager.get_session(&session.id).await.unwrap();
        // Note: SessionSnapshot doesn't expose state directly, so we verify through behavior

        // When presenter leaves, session should enter grace period (PresenterDisconnected)
        let presenter_participant_id = snapshot.presenter.id;
        let was_presenter = manager
            .remove_participant(&session.id, presenter_participant_id)
            .await
            .expect("Remove should succeed");

        assert!(
            was_presenter,
            "Removing presenter should return true for was_presenter"
        );
    }
}
