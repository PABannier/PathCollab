fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Compile protobuf definitions
    prost_build::Config::new()
        .bytes(["."])  // Use bytes::Bytes for byte fields
        .compile_protos(&["proto/overlay.proto"], &["proto/"])?;

    // Tell cargo to rerun if proto files change
    println!("cargo:rerun-if-changed=proto/overlay.proto");

    Ok(())
}
