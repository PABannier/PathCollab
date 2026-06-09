fn main() {
    prost_build::compile_protos(
        &["../proto/overlays.proto", "../proto/heatmaps.proto"],
        &["../proto/"],
    )
    .expect("Failed to compile protobuf");
}
