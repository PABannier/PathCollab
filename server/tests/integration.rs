//! Integration Tests for PathCollab Server
//!
//! These tests verify the full flow of WebSocket and HTTP endpoints,
//! testing the system as a whole rather than individual units.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use pathcollab_server::protocol::{ClientMessage, ServerMessage};
use tower::util::ServiceExt;

// Re-export test utilities from the main crate
mod common;
use common::*;

// ============================================================================
// HTTP Route Integration Tests
// ============================================================================

mod http_routes {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_health_endpoint_returns_ok() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["status"], "ok");
        assert!(json["version"].is_string());
    }

    #[tokio::test]
    async fn test_overlay_upload_requires_valid_session() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/overlay/upload?session_id=nonexistent")
                    .header("Content-Type", "application/octet-stream")
                    .body(Body::from(vec![0u8; 100]))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Should return 404 for non-existent session
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_overlay_upload_requires_presenter_key() {
        let (app, state) = create_test_app_with_state();
        let (session, _, _) = state
            .session_manager
            .create_session(create_test_slide_info(), Uuid::new_v4())
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/overlay/upload?session_id={}", session.id))
                    .header("Content-Type", "application/octet-stream")
                    .body(Body::from(vec![0u8; 10]))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_overlay_upload_rejects_invalid_presenter_key() {
        let (app, state) = create_test_app_with_state();
        let (session, _, _) = state
            .session_manager
            .create_session(create_test_slide_info(), Uuid::new_v4())
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/overlay/upload?session_id={}", session.id))
                    .header("Content-Type", "application/octet-stream")
                    .header("x-presenter-key", "invalid")
                    .body(Body::from(vec![0u8; 10]))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_overlay_upload_accepts_presenter_key() {
        let (app, state) = create_test_app_with_state();
        let (session, _, presenter_key) = state
            .session_manager
            .create_session(create_test_slide_info(), Uuid::new_v4())
            .await
            .unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/overlay/upload?session_id={}", session.id))
                    .header("Content-Type", "application/octet-stream")
                    .header("x-presenter-key", presenter_key)
                    .body(Body::from(vec![0u8; 10]))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_overlay_manifest_not_found() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/overlay/nonexistent/manifest")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_raster_tile_not_found() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/overlay/nonexistent/raster/0/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_vector_chunk_not_found() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/overlay/nonexistent/vec/0/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_viewport_query_not_found() {
        let app = create_test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/overlay/nonexistent/query?min_x=0&min_y=0&max_x=100&max_y=100")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

// ============================================================================
// Session Management Integration Tests
// ============================================================================

mod session_management {
    use super::*;
    use pathcollab_server::protocol::ParticipantRole;
    use pathcollab_server::session::manager::SessionManager;
    use uuid::Uuid;

    #[tokio::test]
    async fn test_create_and_get_session() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        let slide = create_test_slide_info();
        let (session, join_secret, presenter_key) = manager
            .create_session(slide.clone(), presenter_id)
            .await
            .expect("Failed to create session");

        // Verify session was created
        assert_eq!(session.slide.id, slide.id);
        assert!(!join_secret.is_empty());
        assert!(!presenter_key.is_empty());

        // Verify we can retrieve it
        let snapshot = manager
            .get_session(&session.id)
            .await
            .expect("Failed to get session");

        assert_eq!(snapshot.id, session.id);
        assert_eq!(snapshot.presenter.role, ParticipantRole::Presenter);
    }

    #[tokio::test]
    async fn test_join_session_flow() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, join_secret, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .expect("Failed to create session");

        // Join session
        let (snapshot, participant) = manager
            .join_session(&session.id, &join_secret)
            .await
            .expect("Failed to join session");

        // Verify follower was added
        assert_eq!(snapshot.followers.len(), 1);
        assert_eq!(participant.role, ParticipantRole::Follower);
        assert_eq!(snapshot.followers[0].id, participant.id);
    }

    #[tokio::test]
    async fn test_multiple_followers_join() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, join_secret, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .expect("Failed to create session");

        // Add multiple followers
        for i in 0..5 {
            let (snapshot, _) = manager
                .join_session(&session.id, &join_secret)
                .await
                .unwrap_or_else(|_| panic!("Failed to join session for follower {}", i));

            assert_eq!(snapshot.followers.len(), i + 1);
        }

        // Verify final count
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(snapshot.followers.len(), 5);
    }

    #[tokio::test]
    async fn test_invalid_join_secret_rejected() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, _, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .expect("Failed to create session");

        // Try to join with invalid secret
        let result = manager.join_session(&session.id, "invalid_secret").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cursor_update_flow() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create and join session
        let (session, join_secret, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .unwrap();

        let (_, follower) = manager
            .join_session(&session.id, &join_secret)
            .await
            .unwrap();

        // Update cursor
        let result = manager
            .update_cursor(&session.id, follower.id, 100.0, 200.0)
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_viewport_update_increments_revision() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, _, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .unwrap();

        let initial_snapshot = manager.get_session(&session.id).await.unwrap();
        let initial_rev = initial_snapshot.rev;

        // Update viewport
        let new_viewport = pathcollab_server::protocol::Viewport {
            center_x: 0.3,
            center_y: 0.4,
            zoom: 2.0,
            timestamp: 12345,
        };

        manager
            .update_presenter_viewport(&session.id, new_viewport)
            .await
            .unwrap();

        // Verify revision incremented
        let updated_snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(updated_snapshot.rev, initial_rev + 1);
    }

    #[tokio::test]
    async fn test_layer_visibility_update() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, _, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .unwrap();

        // Update layer visibility
        let new_visibility = pathcollab_server::protocol::LayerVisibility {
            tissue_heatmap_visible: false,
            tissue_heatmap_opacity: 0.8,
            tissue_classes_visible: vec![0, 1, 2],
            cell_polygons_visible: true,
            cell_polygons_opacity: 0.6,
            cell_classes_visible: vec![0, 1, 2, 3, 4],
            cell_hover_enabled: false,
        };

        manager
            .update_layer_visibility(&session.id, new_visibility.clone())
            .await
            .unwrap();

        // Verify update
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert!(!snapshot.layer_visibility.tissue_heatmap_visible);
        assert!(!snapshot.layer_visibility.cell_hover_enabled);
    }

    #[tokio::test]
    async fn test_remove_participant() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create and join session
        let (session, join_secret, _) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .unwrap();

        let (_, follower) = manager
            .join_session(&session.id, &join_secret)
            .await
            .unwrap();

        // Verify follower exists
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(snapshot.followers.len(), 1);

        // Remove follower
        let was_presenter = manager
            .remove_participant(&session.id, follower.id)
            .await
            .unwrap();
        assert!(!was_presenter);

        // Verify follower removed
        let snapshot = manager.get_session(&session.id).await.unwrap();
        assert_eq!(snapshot.followers.len(), 0);
    }

    #[tokio::test]
    async fn test_presenter_auth() {
        let manager = SessionManager::new();
        let presenter_id = Uuid::new_v4();

        // Create session
        let (session, _, presenter_key) = manager
            .create_session(create_test_slide_info(), presenter_id)
            .await
            .unwrap();

        // Valid presenter key should authenticate
        let result = manager
            .authenticate_presenter(&session.id, &presenter_key)
            .await;
        assert!(result.is_ok());

        // Invalid presenter key should fail
        let result = manager
            .authenticate_presenter(&session.id, "invalid_key")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_session_count() {
        let manager = SessionManager::new();

        assert_eq!(manager.session_count_async().await, 0);

        // Create sessions
        for _ in 0..3 {
            manager
                .create_session(create_test_slide_info(), Uuid::new_v4())
                .await
                .unwrap();
        }

        assert_eq!(manager.session_count_async().await, 3);
    }
}

// ============================================================================
// Protocol Message Tests
// ============================================================================

mod protocol {
    use super::*;
    use pathcollab_server::protocol::*;

    #[test]
    fn test_client_message_serialization() {
        let msg = ClientMessage::CreateSession {
            slide_id: "test-slide".to_string(),
            seq: 1,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("create_session"));
        assert!(json.contains("test-slide"));
    }

    #[test]
    fn test_client_message_deserialization() {
        let json = r#"{"type":"create_session","slide_id":"test-slide","seq":1}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();

        match msg {
            ClientMessage::CreateSession { slide_id, seq } => {
                assert_eq!(slide_id, "test-slide");
                assert_eq!(seq, 1);
            }
            _ => panic!("Expected CreateSession message"),
        }
    }

    #[test]
    fn test_server_message_serialization() {
        let msg = ServerMessage::Pong;
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("pong"));
    }

    #[test]
    fn test_layer_visibility_default() {
        let visibility = LayerVisibility::default();

        assert!(visibility.tissue_heatmap_visible);
        assert!(visibility.cell_polygons_visible);
        assert!(visibility.cell_hover_enabled);
        assert_eq!(visibility.tissue_heatmap_opacity, 0.5);
    }

    #[test]
    fn test_qos_profile_default() {
        let profile = QosProfileData::default();

        assert_eq!(profile.cursor_send_hz, 30);
        assert_eq!(profile.viewport_send_hz, 10);
        assert_eq!(profile.overlay_batch_kb, 256);
    }

    #[test]
    fn test_join_session_message() {
        let json = r#"{
            "type": "join_session",
            "session_id": "abc123",
            "join_secret": "secret",
            "seq": 5
        }"#;

        let msg: ClientMessage = serde_json::from_str(json).unwrap();

        match msg {
            ClientMessage::JoinSession {
                session_id,
                join_secret,
                seq,
                ..
            } => {
                assert_eq!(session_id, "abc123");
                assert_eq!(join_secret, "secret");
                assert_eq!(seq, 5);
            }
            _ => panic!("Expected JoinSession message"),
        }
    }

    #[test]
    fn test_cursor_update_message() {
        let json = r#"{
            "type": "cursor_update",
            "x": 100.5,
            "y": 200.5,
            "seq": 10
        }"#;

        let msg: ClientMessage = serde_json::from_str(json).unwrap();

        match msg {
            ClientMessage::CursorUpdate { x, y, seq } => {
                assert_eq!(x, 100.5);
                assert_eq!(y, 200.5);
                assert_eq!(seq, 10);
            }
            _ => panic!("Expected CursorUpdate message"),
        }
    }

    #[test]
    fn test_viewport_update_message() {
        let json = r#"{
            "type": "viewport_update",
            "center_x": 0.3,
            "center_y": 0.4,
            "zoom": 2.5,
            "seq": 15
        }"#;

        let msg: ClientMessage = serde_json::from_str(json).unwrap();

        match msg {
            ClientMessage::ViewportUpdate {
                center_x,
                center_y,
                zoom,
                seq,
            } => {
                assert_eq!(center_x, 0.3);
                assert_eq!(center_y, 0.4);
                assert_eq!(zoom, 2.5);
                assert_eq!(seq, 15);
            }
            _ => panic!("Expected ViewportUpdate message"),
        }
    }
}
