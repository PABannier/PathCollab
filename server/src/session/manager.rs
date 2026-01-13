use crate::protocol::{
    LayerVisibility, Participant, ParticipantRole, SessionSnapshot, SlideInfo, Viewport,
};
use crate::session::state::{
    Session, SessionConfig, SessionId, SessionParticipant, SessionState, generate_participant_name,
    generate_secret, generate_session_id, get_participant_color, now_millis,
};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
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

        // Store session
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }

        // Return session data (need to read it back)
        let sessions = self.sessions.read().await;
        let session = sessions.get(&session_id).unwrap().clone();

        Ok((session, join_secret, presenter_key))
    }

    /// Join an existing session
    pub async fn join_session(
        &self,
        session_id: &str,
        join_secret: &str,
    ) -> Result<(SessionSnapshot, Participant), SessionError> {
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

/// Simple hash function for secrets (use argon2 in production)
fn hash_secret(secret: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    secret.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
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
}
