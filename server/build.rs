fn main() {
    prost_build::compile_protos(
        &["../proto/overlays.proto", "../proto/new_cell_masks.proto"],
        &["../proto/"],
    )
    .expect("Failed to compile protobuf");
}
