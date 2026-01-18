//! Micro-benchmarks for WebSocket message serialization
//!
//! These benchmarks test the JSON serialization performance for:
//! - Cursor update messages (high frequency: 30Hz)
//! - Viewport update messages (medium frequency: 10Hz)
//! - Presence delta broadcasts (fan-out to all followers)
//!
//! Run with: cargo bench --bench message_serialization

use criterion::{BenchmarkId, Criterion, Throughput, black_box, criterion_group, criterion_main};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Cursor position with participant info (sent via PresenceDelta)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CursorWithParticipant {
    participant_id: Uuid,
    name: String,
    color: String,
    is_presenter: bool,
    x: f64,
    y: f64,
}

/// Viewport state
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Viewport {
    center_x: f64,
    center_y: f64,
    zoom: f64,
    timestamp: u64,
}

/// Server messages (subset for benchmarking)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    PresenceDelta {
        changed: Vec<CursorWithParticipant>,
        removed: Vec<Uuid>,
        server_ts: u64,
    },
    PresenterViewport {
        viewport: Viewport,
    },
    Ack {
        ack_seq: u64,
        status: AckStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AckStatus {
    Ok,
    Rejected,
}

/// Client messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    CursorUpdate { x: f64, y: f64, seq: u64 },
    ViewportUpdate {
        center_x: f64,
        center_y: f64,
        zoom: f64,
        seq: u64,
    },
    Ping { seq: u64 },
}

fn create_cursor_update() -> ClientMessage {
    ClientMessage::CursorUpdate {
        x: 0.5123456789,
        y: 0.7987654321,
        seq: 12345,
    }
}

fn create_viewport_update() -> ClientMessage {
    ClientMessage::ViewportUpdate {
        center_x: 50000.123456,
        center_y: 50000.789012,
        zoom: 2.5,
        seq: 12346,
    }
}

fn create_presence_delta(num_cursors: usize) -> ServerMessage {
    let changed: Vec<_> = (0..num_cursors)
        .map(|i| CursorWithParticipant {
            participant_id: Uuid::new_v4(),
            name: format!("User {}", i),
            color: "#FF5733".to_string(),
            is_presenter: i == 0,
            x: 0.5 + (i as f64 * 0.01),
            y: 0.5 + (i as f64 * 0.01),
        })
        .collect();

    ServerMessage::PresenceDelta {
        changed,
        removed: vec![],
        server_ts: 1705555200000,
    }
}

fn create_viewport_broadcast() -> ServerMessage {
    ServerMessage::PresenterViewport {
        viewport: Viewport {
            center_x: 50000.123456,
            center_y: 50000.789012,
            zoom: 2.5,
            timestamp: 1705555200000,
        },
    }
}

fn bench_client_message_serialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("client_serialize");

    let cursor_update = create_cursor_update();
    let viewport_update = create_viewport_update();

    group.throughput(Throughput::Elements(1));

    group.bench_function("cursor_update", |b| {
        b.iter(|| serde_json::to_string(black_box(&cursor_update)))
    });

    group.bench_function("viewport_update", |b| {
        b.iter(|| serde_json::to_string(black_box(&viewport_update)))
    });

    group.finish();
}

fn bench_client_message_deserialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("client_deserialize");

    let cursor_json = serde_json::to_string(&create_cursor_update()).unwrap();
    let viewport_json = serde_json::to_string(&create_viewport_update()).unwrap();

    group.throughput(Throughput::Elements(1));

    group.bench_function("cursor_update", |b| {
        b.iter(|| serde_json::from_str::<ClientMessage>(black_box(&cursor_json)))
    });

    group.bench_function("viewport_update", |b| {
        b.iter(|| serde_json::from_str::<ClientMessage>(black_box(&viewport_json)))
    });

    group.finish();
}

fn bench_server_message_serialize(c: &mut Criterion) {
    let mut group = c.benchmark_group("server_serialize");

    // Presence delta with varying number of cursors
    for num_cursors in [1, 5, 10, 20] {
        let delta = create_presence_delta(num_cursors);

        group.bench_with_input(
            BenchmarkId::new("presence_delta", num_cursors),
            &delta,
            |b, delta| {
                b.iter(|| serde_json::to_string(black_box(delta)))
            },
        );
    }

    let viewport_broadcast = create_viewport_broadcast();
    group.bench_function("viewport_broadcast", |b| {
        b.iter(|| serde_json::to_string(black_box(&viewport_broadcast)))
    });

    let ack = ServerMessage::Ack {
        ack_seq: 12345,
        status: AckStatus::Ok,
        reason: None,
    };
    group.bench_function("ack", |b| {
        b.iter(|| serde_json::to_string(black_box(&ack)))
    });

    let pong = ServerMessage::Pong;
    group.bench_function("pong", |b| {
        b.iter(|| serde_json::to_string(black_box(&pong)))
    });

    group.finish();
}

fn bench_roundtrip(c: &mut Criterion) {
    let mut group = c.benchmark_group("roundtrip");
    group.throughput(Throughput::Elements(1));

    // Typical hot path: client sends cursor, server broadcasts presence
    let cursor = create_cursor_update();
    let presence = create_presence_delta(5);

    group.bench_function("cursor_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&cursor)).unwrap();
            serde_json::from_str::<ClientMessage>(black_box(&json))
        })
    });

    group.bench_function("presence_5_roundtrip", |b| {
        b.iter(|| {
            let json = serde_json::to_string(black_box(&presence)).unwrap();
            serde_json::from_str::<ServerMessage>(black_box(&json))
        })
    });

    group.finish();
}

fn bench_broadcast_scaling(c: &mut Criterion) {
    let mut group = c.benchmark_group("broadcast_scaling");

    // Simulate serializing a message N times for N followers
    // (In production we serialize once and clone, but this shows the cost)
    let presence = create_presence_delta(1);
    let json = serde_json::to_string(&presence).unwrap();

    for follower_count in [5, 10, 20, 50] {
        group.throughput(Throughput::Elements(follower_count as u64));

        group.bench_with_input(
            BenchmarkId::new("clone_json", follower_count),
            &json,
            |b, json| {
                b.iter(|| {
                    (0..follower_count)
                        .map(|_| black_box(json.clone()))
                        .collect::<Vec<_>>()
                })
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_client_message_serialize,
    bench_client_message_deserialize,
    bench_server_message_serialize,
    bench_roundtrip,
    bench_broadcast_scaling,
);
criterion_main!(benches);
