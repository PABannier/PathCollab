//! Integration Tests for PathCollab Server
//!
//! These tests verify the full flow of WebSocket and HTTP endpoints,
//! testing the system as a whole rather than individual units.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use pathcollab_server::protocol::{ClientMessage, ParticipantRole, ServerMessage};
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

// ============================================================================
// Tile Serving Integration Tests
// Phase 1 spec: Tile API endpoints (IMPLEMENTATION_PLAN.md Week 1, Day 3-4)
// ============================================================================

mod tile_serving {
    use super::*;
    use axum::http::header;

    /// Phase 1 spec: GET /api/slides returns list of available slides
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.2
    #[tokio::test]
    async fn test_list_slides_returns_json() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slides")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let slides: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap();

        // Should have at least one test slide
        assert!(!slides.is_empty());
        assert!(slides[0].get("id").is_some());
        assert!(slides[0].get("name").is_some());
    }

    /// Phase 1 spec: GET /api/slide/:id returns slide metadata
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.2 (SlideInfo structure)
    #[tokio::test]
    async fn test_get_slide_metadata() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let metadata: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // Phase 1 spec: SlideInfo must have these fields
        assert_eq!(metadata["id"], "test-slide");
        assert!(metadata["width"].is_number());
        assert!(metadata["height"].is_number());
        assert!(metadata["tile_size"].is_number());
        assert!(metadata["num_levels"].is_number());
    }

    /// Phase 1 spec: GET /api/slide/:id returns 404 for non-existent slide
    /// Reference: IMPLEMENTATION_PLAN.md (error handling)
    #[tokio::test]
    async fn test_get_nonexistent_slide_returns_404() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let error: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(error["code"], "not_found");
    }

    /// Phase 1 spec: GET /api/slide/:id/dzi returns valid DZI XML
    /// Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4 (OpenSeadragon integration)
    #[tokio::test]
    async fn test_dzi_endpoint_returns_valid_xml() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide/dzi")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Check content type
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(content_type.contains("application/xml"));

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let xml = String::from_utf8_lossy(&body);

        // Phase 1 spec: DZI XML must have specific structure
        assert!(xml.contains("<?xml version"));
        assert!(xml.contains("Image xmlns"));
        assert!(xml.contains("Format=\"jpeg\""));
        assert!(xml.contains("TileSize="));
        assert!(xml.contains("<Size"));
        assert!(xml.contains("Width="));
        assert!(xml.contains("Height="));
    }

    /// Phase 1 spec: GET /api/slide/:id/tile/:level/:x/:y returns JPEG tile
    /// Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4 (tile rendering)
    #[tokio::test]
    async fn test_tile_endpoint_returns_jpeg() {
        let app = create_test_app_with_slides();

        // Request tile at level 13 (near max for 10000x10000 slide), position 0,0
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide/tile/13/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Phase 1 spec: Tiles must be JPEG format
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(content_type, "image/jpeg");

        // Verify it's actual JPEG data (starts with FFD8)
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.len() > 2);
        assert_eq!(body[0], 0xFF);
        assert_eq!(body[1], 0xD8);
    }

    /// Phase 1 spec: Tile cache headers for immutability
    /// Reference: IMPLEMENTATION_PLAN.md (performance: tiles immutable, cacheable)
    #[tokio::test]
    async fn test_tile_has_immutable_cache_headers() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide/tile/13/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Phase 1 spec: Tiles should have long cache time
        let cache_control = response
            .headers()
            .get(header::CACHE_CONTROL)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cache_control.contains("immutable"));
        assert!(cache_control.contains("max-age=31536000")); // 1 year
    }

    /// Phase 1 spec: Invalid tile coordinates return 400 Bad Request
    /// Reference: IMPLEMENTATION_PLAN.md (error handling)
    #[tokio::test]
    async fn test_tile_invalid_coordinates_returns_400() {
        let app = create_test_app_with_slides();

        // Request tile way out of bounds
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide/tile/13/99999/99999")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let error: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(error["code"], "invalid_coordinates");
    }

    /// Phase 1 spec: Invalid level returns 400 Bad Request
    /// Reference: IMPLEMENTATION_PLAN.md (error handling)
    #[tokio::test]
    async fn test_tile_invalid_level_returns_400() {
        let app = create_test_app_with_slides();

        // Request tile at level 99 (way above max)
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide/tile/99/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let error: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(error["code"], "invalid_level");
    }

    /// Phase 1 spec: Tile for non-existent slide returns 404
    /// Reference: IMPLEMENTATION_PLAN.md (error handling)
    #[tokio::test]
    async fn test_tile_nonexistent_slide_returns_404() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/nonexistent/tile/0/0/0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// Phase 1 spec: Slide metadata includes tile_size field
    /// Reference: IMPLEMENTATION_PLAN.md Section 2.2 (tile_size: 256 or 512)
    #[tokio::test]
    async fn test_slide_metadata_has_tile_size() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let metadata: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // Phase 1 spec: tile_size should be 256 or 512 (typically 256)
        let tile_size = metadata["tile_size"].as_u64().unwrap();
        assert!(tile_size == 256 || tile_size == 512);
    }

    /// Phase 1 spec: Slide metadata includes num_levels (pyramid levels)
    /// Reference: IMPLEMENTATION_PLAN.md Week 1, Day 3-4 (multi-level pyramid)
    #[tokio::test]
    async fn test_slide_metadata_has_pyramid_levels() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/test-slide")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let metadata: serde_json::Value = serde_json::from_slice(&body).unwrap();

        // Phase 1 spec: Multi-level pyramid support
        let num_levels = metadata["num_levels"].as_u64().unwrap();
        assert!(num_levels > 1); // Must have multiple levels
    }

    /// Phase 1 spec: DZI endpoint returns 404 for non-existent slide
    /// Reference: IMPLEMENTATION_PLAN.md (error handling)
    #[tokio::test]
    async fn test_dzi_nonexistent_slide_returns_404() {
        let app = create_test_app_with_slides();

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/slide/nonexistent/dzi")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

// ============================================================================
// WebSocket Protocol Integration Tests
// Phase 1 spec: WebSocket connection lifecycle (IMPLEMENTATION_PLAN.md Week 2)
// ============================================================================

mod websocket_protocol {
    use axum::{Router, routing::get};
    use pathcollab_server::protocol::{ClientMessage, ServerMessage};
    use pathcollab_server::server::AppState;
    use std::net::SocketAddr;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    /// Start a test server on a random port
    async fn start_test_server() -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let state = AppState::new();

        let app = Router::new()
            .route("/ws", get(pathcollab_server::server::ws_handler))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        // Give server time to start
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        (addr, handle)
    }

    /// Phase 1 spec: WebSocket connection establishes successfully
    /// Reference: IMPLEMENTATION_PLAN.md Week 2, Day 1-2
    #[tokio::test]
    async fn test_websocket_connection_establishes() {
        let (addr, server_handle) = start_test_server().await;

        let ws_url = format!("ws://{}/ws", addr);
        let result = connect_async(&ws_url).await;

        assert!(result.is_ok(), "WebSocket connection should establish");

        server_handle.abort();
    }

    /// Phase 1 spec: Server responds to ping with pong
    /// Reference: IMPLEMENTATION_PLAN.md Week 2 (keepalive ping/pong)
    #[tokio::test]
    async fn test_ping_pong_protocol() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        let (mut ws_stream, _) = connect_async(&ws_url).await.unwrap();

        // Send ping message
        let ping_msg = ClientMessage::Ping { seq: 1 };
        let ping_json = serde_json::to_string(&ping_msg).unwrap();
        ws_stream.send(Message::Text(ping_json.into())).await.unwrap();

        // Expect pong response
        let mut received_pong = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while let Some(msg) = ws_stream.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if matches!(server_msg, ServerMessage::Pong) {
                            received_pong = true;
                            break;
                        }
                    }
                }
            }
        });

        let _ = timeout.await;
        assert!(received_pong, "Server should respond with pong");

        server_handle.abort();
    }

    /// Phase 1 spec: create_session returns session_created with valid IDs
    /// Reference: IMPLEMENTATION_PLAN.md Week 2, Day 3-4
    #[tokio::test]
    async fn test_create_session_over_websocket() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        let (mut ws_stream, _) = connect_async(&ws_url).await.unwrap();

        // Send create_session message
        let create_msg = ClientMessage::CreateSession {
            slide_id: "test-slide".to_string(),
            seq: 1,
        };
        let json = serde_json::to_string(&create_msg).unwrap();
        ws_stream.send(Message::Text(json.into())).await.unwrap();

        // Wait for session_created response
        let mut session_created = false;
        let mut session_id: Option<String> = None;
        let mut join_secret: Option<String> = None;
        let mut presenter_key: Option<String> = None;

        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws_stream.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        match server_msg {
                            ServerMessage::SessionCreated {
                                session,
                                join_secret: js,
                                presenter_key: pk,
                            } => {
                                session_created = true;
                                session_id = Some(session.id);
                                join_secret = Some(js);
                                presenter_key = Some(pk);
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        let _ = timeout.await;

        // Phase 1 spec: SessionCreated must include all required fields
        assert!(session_created, "Should receive session_created");
        assert!(session_id.is_some(), "Should have session_id");
        assert!(join_secret.is_some(), "Should have join_secret");
        assert!(presenter_key.is_some(), "Should have presenter_key");

        // Phase 1 spec: Session ID must be 10-char base32
        let sid = session_id.unwrap();
        assert_eq!(sid.len(), 10, "Session ID should be 10 characters");
        assert!(
            sid.chars().all(|c| "abcdefghijklmnopqrstuvwxyz234567".contains(c)),
            "Session ID should be base32"
        );

        // Phase 1 spec: join_secret must have 128+ bits entropy (32+ hex chars)
        assert!(
            join_secret.unwrap().len() >= 32,
            "join_secret should have sufficient entropy"
        );

        // Phase 1 spec: presenter_key must have 192+ bits entropy (48+ hex chars)
        assert!(
            presenter_key.unwrap().len() >= 48,
            "presenter_key should have sufficient entropy"
        );

        server_handle.abort();
    }

    /// Phase 1 spec: join_session with valid secret succeeds
    /// Reference: IMPLEMENTATION_PLAN.md Week 2, Day 3-4
    #[tokio::test]
    async fn test_join_session_over_websocket() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // First connection: create session
        let (mut ws1, _) = connect_async(&ws_url).await.unwrap();

        let create_msg = ClientMessage::CreateSession {
            slide_id: "test-slide".to_string(),
            seq: 1,
        };
        ws1.send(Message::Text(serde_json::to_string(&create_msg).unwrap().into()))
            .await
            .unwrap();

        // Get session details from first connection
        let mut session_id = String::new();
        let mut join_secret = String::new();

        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws1.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::SessionCreated {
                            session,
                            join_secret: js,
                            ..
                        } = server_msg
                        {
                            session_id = session.id;
                            join_secret = js;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(!session_id.is_empty(), "Should have created session");

        // Second connection: join session
        let (mut ws2, _) = connect_async(&ws_url).await.unwrap();

        let join_msg = ClientMessage::JoinSession {
            session_id: session_id.clone(),
            join_secret: join_secret.clone(),
            last_seen_rev: None,
            seq: 1,
        };
        ws2.send(Message::Text(serde_json::to_string(&join_msg).unwrap().into()))
            .await
            .unwrap();

        // Wait for session_joined response
        let mut session_joined = false;

        let timeout2 = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws2.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::SessionJoined { session, you } = server_msg {
                            session_joined = true;
                            // Verify session matches
                            assert_eq!(session.id, session_id);
                            // Verify follower has been assigned a name and color
                            assert!(!you.name.is_empty());
                            assert!(!you.color.is_empty());
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout2.await;

        assert!(session_joined, "Should receive session_joined");

        server_handle.abort();
    }

    /// Phase 1 spec: join_session with invalid secret fails
    /// Reference: IMPLEMENTATION_PLAN.md (security: invalid secret rejected)
    #[tokio::test]
    async fn test_join_session_invalid_secret_fails() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // First: create session
        let (mut ws1, _) = connect_async(&ws_url).await.unwrap();
        let create_msg = ClientMessage::CreateSession {
            slide_id: "test-slide".to_string(),
            seq: 1,
        };
        ws1.send(Message::Text(serde_json::to_string(&create_msg).unwrap().into()))
            .await
            .unwrap();

        let mut session_id = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws1.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated { session, .. }) =
                        serde_json::from_str::<ServerMessage>(&text)
                    {
                        session_id = session.id;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Try to join with wrong secret
        let (mut ws2, _) = connect_async(&ws_url).await.unwrap();
        let join_msg = ClientMessage::JoinSession {
            session_id: session_id.clone(),
            join_secret: "wrong_secret".to_string(),
            last_seen_rev: None,
            seq: 1,
        };
        ws2.send(Message::Text(serde_json::to_string(&join_msg).unwrap().into()))
            .await
            .unwrap();

        // Should receive error
        let mut received_error = false;
        let timeout2 = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws2.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if matches!(server_msg, ServerMessage::SessionError { .. }) {
                            received_error = true;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout2.await;

        assert!(received_error, "Should receive error for invalid secret");

        server_handle.abort();
    }

    /// Phase 1 spec: Ack message contains seq number
    /// Reference: IMPLEMENTATION_PLAN.md (message protocol)
    #[tokio::test]
    async fn test_ack_message_contains_seq() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        let (mut ws_stream, _) = connect_async(&ws_url).await.unwrap();

        // Send ping with specific seq
        let ping_msg = ClientMessage::Ping { seq: 42 };
        ws_stream
            .send(Message::Text(serde_json::to_string(&ping_msg).unwrap().into()))
            .await
            .unwrap();

        // Should receive ack with matching seq
        let mut found_ack = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while let Some(msg) = ws_stream.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::Ack { ack_seq, .. } = server_msg {
                            if ack_seq == 42 {
                                found_ack = true;
                                break;
                            }
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(found_ack, "Should receive ack with matching seq number");

        server_handle.abort();
    }
}

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

// ============================================================================
// Phase 2 Integration Tests - Collaboration MVP
// Tests for cursor presence, viewport sync, and participant management
// Reference: IMPLEMENTATION_PLAN.md Phase 2 (Weeks 3-4)
// ============================================================================

mod phase2_presence {
    use super::*;
    use axum::{Router, routing::get};
    use pathcollab_server::protocol::{ClientMessage, ServerMessage};
    use pathcollab_server::server::AppState;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    async fn start_test_server() -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        let state = AppState::new();

        let app = Router::new()
            .route("/ws", get(pathcollab_server::server::ws_handler))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        (addr, handle)
    }

    /// Phase 2 spec: Cursor updates are stored and broadcast to session
    /// Reference: IMPLEMENTATION_PLAN.md Week 3, Day 1-2 (cursor tracking)
    #[tokio::test]
    async fn test_cursor_update_broadcast_to_session() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Presenter creates session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        let create_msg = ClientMessage::CreateSession {
            slide_id: "test-slide".to_string(),
            seq: 1,
        };
        presenter
            .send(Message::Text(serde_json::to_string(&create_msg).unwrap().into()))
            .await
            .unwrap();

        // Get session info
        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;
        assert!(!session_id.is_empty());

        // Follower joins session
        let (mut follower, _) = connect_async(&ws_url).await.unwrap();
        let join_msg = ClientMessage::JoinSession {
            session_id: session_id.clone(),
            join_secret: join_secret.clone(),
            last_seen_rev: None,
            seq: 1,
        };
        follower
            .send(Message::Text(serde_json::to_string(&join_msg).unwrap().into()))
            .await
            .unwrap();

        // Wait for follower to join
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Presenter sends cursor update
        let cursor_msg = ClientMessage::CursorUpdate {
            x: 500.0,
            y: 300.0,
            seq: 2,
        };
        presenter
            .send(Message::Text(serde_json::to_string(&cursor_msg).unwrap().into()))
            .await
            .unwrap();

        // Follower should receive presence_delta with cursor
        let mut received_cursor = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = follower.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::PresenceDelta { changed, .. } = server_msg {
                            if !changed.is_empty() {
                                // Phase 2 spec: cursor should have x, y, and participant info
                                let cursor = &changed[0];
                                if (cursor.x - 500.0).abs() < 0.01 && (cursor.y - 300.0).abs() < 0.01 {
                                    received_cursor = true;
                                    // Phase 2 spec: cursor should include participant name and color
                                    assert!(!cursor.name.is_empty());
                                    assert!(!cursor.color.is_empty());
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(received_cursor, "Follower should receive presenter's cursor update");

        server_handle.abort();
    }

    /// Phase 2 spec: Presenter viewport broadcast to followers at 10Hz
    /// Reference: IMPLEMENTATION_PLAN.md Week 3, Day 3-4 (viewport sync)
    #[tokio::test]
    async fn test_presenter_viewport_broadcast() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Presenter creates session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Follower joins
        let (mut follower, _) = connect_async(&ws_url).await.unwrap();
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Presenter sends viewport update
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::ViewportUpdate {
                    center_x: 0.5,
                    center_y: 0.5,
                    zoom: 2.0,
                    seq: 2,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        // Follower should receive presenter_viewport
        let mut received_viewport = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = follower.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::PresenterViewport { viewport } = server_msg {
                            // Phase 2 spec: viewport has center_x, center_y, zoom
                            assert!((viewport.center_x - 0.5).abs() < 0.01);
                            assert!((viewport.center_y - 0.5).abs() < 0.01);
                            assert!((viewport.zoom - 2.0).abs() < 0.01);
                            received_viewport = true;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(
            received_viewport,
            "Follower should receive presenter viewport update"
        );

        server_handle.abort();
    }

    /// Phase 2 spec: Snap to presenter returns current presenter viewport
    /// Reference: IMPLEMENTATION_PLAN.md Week 3, Day 3-4
    #[tokio::test]
    async fn test_snap_to_presenter() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Presenter creates session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Presenter sets viewport
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::ViewportUpdate {
                    center_x: 0.7,
                    center_y: 0.3,
                    zoom: 4.0,
                    seq: 2,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // Follower joins and snaps
        let (mut follower, _) = connect_async(&ws_url).await.unwrap();
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Follower requests snap to presenter
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::SnapToPresenter { seq: 2 })
                    .unwrap()
                    .into(),
            ))
            .await
            .unwrap();

        // Follower should receive presenter viewport
        let mut received_viewport = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = follower.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::PresenterViewport { viewport } = server_msg {
                            // Should receive the viewport presenter set earlier
                            if (viewport.zoom - 4.0).abs() < 0.01 {
                                assert!((viewport.center_x - 0.7).abs() < 0.01);
                                assert!((viewport.center_y - 0.3).abs() < 0.01);
                                received_viewport = true;
                                break;
                            }
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(received_viewport, "Snap to presenter should return presenter's viewport");

        server_handle.abort();
    }

    /// Phase 2 spec: Follower viewport updates don't broadcast (only presenter)
    /// Reference: IMPLEMENTATION_PLAN.md Week 3, Day 3-4
    #[tokio::test]
    async fn test_follower_viewport_not_broadcast() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Presenter creates session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Follower joins
        let (mut follower, _) = connect_async(&ws_url).await.unwrap();
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Follower sends viewport update
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::ViewportUpdate {
                    center_x: 0.1,
                    center_y: 0.1,
                    zoom: 1.0,
                    seq: 2,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        // Presenter should NOT receive viewport update from follower
        let received_follower_viewport = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            async {
                while let Some(msg) = presenter.next().await {
                    if let Ok(Message::Text(text)) = msg {
                        if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                            if let ServerMessage::PresenterViewport { viewport } = server_msg {
                                // If we receive this with follower's viewport, that's wrong
                                if (viewport.center_x - 0.1).abs() < 0.01 {
                                    return true;
                                }
                            }
                        }
                    }
                }
                false
            },
        )
        .await;

        // Should timeout or not receive follower's viewport
        assert!(
            received_follower_viewport.is_err() || !received_follower_viewport.unwrap(),
            "Presenter should NOT receive follower's viewport updates"
        );

        server_handle.abort();
    }
}

mod phase2_participants {
    use super::*;
    use axum::{Router, routing::get};
    use pathcollab_server::protocol::{ClientMessage, ServerMessage};
    use pathcollab_server::server::AppState;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    async fn start_test_server() -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        let state = AppState::new();

        let app = Router::new()
            .route("/ws", get(pathcollab_server::server::ws_handler))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        (addr, handle)
    }

    /// Phase 2 spec: Participant names use adjective + animal format
    /// Reference: IMPLEMENTATION_PLAN.md Week 4, Day 3-4
    #[tokio::test]
    async fn test_participant_name_format() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        let (mut ws, _) = connect_async(&ws_url).await.unwrap();
        ws.send(Message::Text(
            serde_json::to_string(&ClientMessage::CreateSession {
                slide_id: "test-slide".to_string(),
                seq: 1,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

        let mut presenter_name = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated { session, .. }) =
                        serde_json::from_str(&text)
                    {
                        presenter_name = session.presenter.name;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Phase 2 spec: Name should be "Adjective Animal" format
        assert!(!presenter_name.is_empty());
        let parts: Vec<&str> = presenter_name.split_whitespace().collect();
        assert_eq!(parts.len(), 2, "Name should be two words: '{}'", presenter_name);

        // First word should be capitalized adjective
        assert!(
            parts[0].chars().next().unwrap().is_uppercase(),
            "Adjective should be capitalized"
        );
        // Second word should be capitalized animal
        assert!(
            parts[1].chars().next().unwrap().is_uppercase(),
            "Animal should be capitalized"
        );

        server_handle.abort();
    }

    /// Phase 2 spec: Participants get colors from 12-color palette
    /// Reference: IMPLEMENTATION_PLAN.md Week 4, Day 3-4
    #[tokio::test]
    async fn test_participant_color_assignment() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Create session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let mut presenter_color = String::new();

        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        presenter_color = session.presenter.color;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Phase 2 spec: Color should be hex format #RRGGBB
        assert!(presenter_color.starts_with('#'));
        assert_eq!(presenter_color.len(), 7);

        // Join multiple followers and check they get different colors
        // Keep followers alive to prevent participant removal
        let mut follower_colors: Vec<String> = vec![presenter_color.clone()];
        let mut follower_connections = Vec::new();

        for _i in 0..3 {
            let (mut follower, _) = connect_async(&ws_url).await.unwrap();
            follower
                .send(Message::Text(
                    serde_json::to_string(&ClientMessage::JoinSession {
                        session_id: session_id.clone(),
                        join_secret: join_secret.clone(),
                        last_seen_rev: None,
                        seq: 1,
                    })
                    .unwrap()
                    .into(),
                ))
                .await
                .unwrap();

            let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while let Some(msg) = follower.next().await {
                    if let Ok(Message::Text(text)) = msg {
                        if let Ok(ServerMessage::SessionJoined { you, .. }) =
                            serde_json::from_str(&text)
                        {
                            return Some((you.color, follower));
                        }
                    }
                }
                None
            });
            if let Ok(Some((color, follower))) = timeout.await {
                follower_colors.push(color);
                follower_connections.push(follower);
            }
        }

        // Keep connections alive until assertions complete
        drop(follower_connections);

        // Phase 2 spec: Colors should cycle through palette sequentially
        // First 4 colors from palette: Blue, Red, Emerald, Amber
        let expected_colors = vec!["#3B82F6", "#EF4444", "#10B981", "#F59E0B"];
        for (i, color) in follower_colors.iter().enumerate() {
            if i < expected_colors.len() {
                assert_eq!(
                    color, expected_colors[i],
                    "Participant {} should have color {}",
                    i, expected_colors[i]
                );
            }
        }

        server_handle.abort();
    }

    /// Phase 2 spec: Participant joined/left events broadcast to session
    /// Reference: IMPLEMENTATION_PLAN.md Week 3, Day 5
    #[tokio::test]
    async fn test_participant_join_leave_events() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Presenter creates session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Small delay to allow presenter's broadcast task to subscribe (polls every 100ms)
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // Follower joins
        let (follower, _) = connect_async(&ws_url).await.unwrap();
        let (mut write, mut _read) = follower.split();
        write
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        // Presenter should receive participant_joined
        let mut received_join = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::ParticipantJoined { participant } = server_msg {
                            // Phase 2 spec: participant_joined includes participant info
                            assert!(!participant.name.is_empty());
                            assert!(!participant.color.is_empty());
                            received_join = true;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(received_join, "Presenter should receive participant_joined event");

        // Close follower connection
        drop(write);
        drop(_read);

        // Presenter should receive participant_left
        let mut received_leave = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if matches!(server_msg, ServerMessage::ParticipantLeft { .. }) {
                            received_leave = true;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(received_leave, "Presenter should receive participant_left event");

        server_handle.abort();
    }

    /// Phase 2 spec: First user becomes presenter
    /// Reference: IMPLEMENTATION_PLAN.md Week 4, Day 3-4
    #[tokio::test]
    async fn test_first_user_is_presenter() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        let (mut ws, _) = connect_async(&ws_url).await.unwrap();
        ws.send(Message::Text(
            serde_json::to_string(&ClientMessage::CreateSession {
                slide_id: "test-slide".to_string(),
                seq: 1,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = ws.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated { session, .. }) =
                        serde_json::from_str(&text)
                    {
                        // Phase 2 spec: Session creator is presenter
                        assert_eq!(session.presenter.role, ParticipantRole::Presenter);
                        assert!(session.followers.is_empty());
                        return true;
                    }
                }
            }
            false
        });

        assert!(timeout.await.unwrap_or(false));

        server_handle.abort();
    }
}

mod phase2_robustness {
    use super::*;
    use axum::{Router, routing::get};
    use pathcollab_server::protocol::{ClientMessage, ServerMessage};
    use pathcollab_server::server::AppState;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    async fn start_test_server() -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
        let state = AppState::new();

        let app = Router::new()
            .route("/ws", get(pathcollab_server::server::ws_handler))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        (addr, handle)
    }

    /// Phase 2 spec: Layer updates only from presenter
    /// Reference: IMPLEMENTATION_PLAN.md (presenter-only actions)
    #[tokio::test]
    async fn test_layer_update_presenter_only() {
        use futures_util::{SinkExt, StreamExt};
        use pathcollab_server::protocol::{AckStatus, LayerVisibility};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Create session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;

        // Follower joins
        let (mut follower, _) = connect_async(&ws_url).await.unwrap();
        follower
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Follower tries to update layers (should be rejected)
        let layer_msg = ClientMessage::LayerUpdate {
            visibility: LayerVisibility::default(),
            seq: 2,
        };
        follower
            .send(Message::Text(serde_json::to_string(&layer_msg).unwrap().into()))
            .await
            .unwrap();

        // Should receive rejected ack
        let mut rejected = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = follower.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::Ack {
                            ack_seq,
                            status,
                            reason,
                        } = server_msg
                        {
                            if ack_seq == 2 && status == AckStatus::Rejected {
                                assert!(reason.is_some());
                                rejected = true;
                                break;
                            }
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(rejected, "Follower's layer update should be rejected");

        server_handle.abort();
    }

    /// Phase 2 spec: Session survives participant reconnection
    /// Reference: IMPLEMENTATION_PLAN.md Week 4, Day 1-2
    #[tokio::test]
    async fn test_session_survives_follower_reconnect() {
        use futures_util::{SinkExt, StreamExt};

        let (addr, server_handle) = start_test_server().await;
        let ws_url = format!("ws://{}/ws", addr);

        // Create session
        let (mut presenter, _) = connect_async(&ws_url).await.unwrap();
        presenter
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::CreateSession {
                    slide_id: "test-slide".to_string(),
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        let mut session_id = String::new();
        let mut join_secret = String::new();
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = presenter.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(ServerMessage::SessionCreated {
                        session,
                        join_secret: js,
                        ..
                    }) = serde_json::from_str(&text)
                    {
                        session_id = session.id;
                        join_secret = js;
                        break;
                    }
                }
            }
        });
        let _ = timeout.await;
        assert!(!session_id.is_empty());

        // Follower joins
        let (follower, _) = connect_async(&ws_url).await.unwrap();
        let (mut write, _read) = follower.split();
        write
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Disconnect follower
        drop(write);
        drop(_read);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Reconnect follower
        let (mut follower2, _) = connect_async(&ws_url).await.unwrap();
        follower2
            .send(Message::Text(
                serde_json::to_string(&ClientMessage::JoinSession {
                    session_id: session_id.clone(),
                    join_secret: join_secret.clone(),
                    last_seen_rev: None,
                    seq: 1,
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

        // Should successfully rejoin
        let mut rejoined = false;
        let timeout = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(msg) = follower2.next().await {
                if let Ok(Message::Text(text)) = msg {
                    if let Ok(server_msg) = serde_json::from_str::<ServerMessage>(&text) {
                        if let ServerMessage::SessionJoined { session, .. } = server_msg {
                            // Session should still exist
                            assert_eq!(session.id, session_id);
                            rejoined = true;
                            break;
                        }
                    }
                }
            }
        });
        let _ = timeout.await;

        assert!(rejoined, "Follower should be able to rejoin after disconnect");

        server_handle.abort();
    }
}
