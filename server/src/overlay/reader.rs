//! Annotation reader implementations for different file formats

use prost::Message;
use std::path::Path;
use tracing::debug;

use super::proto::SlideSegmentationData;
use super::reader_v2;
use super::types::OverlayError;

/// Trait for reading annotation files in different formats
pub trait AnnotationReader: Send + Sync {
    /// Check if this reader can handle the given file
    fn can_read(&self, path: &Path) -> bool;

    /// Read and parse the annotation file
    fn read(&self, path: &Path) -> Result<SlideSegmentationData, OverlayError>;
}

/// Protobuf reader for .bin and .pb files
pub struct ProtobufReader;

impl AnnotationReader for ProtobufReader {
    fn can_read(&self, path: &Path) -> bool {
        matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("bin" | "pb")
        )
    }

    fn read(&self, path: &Path) -> Result<SlideSegmentationData, OverlayError> {
        let bytes = std::fs::read(path)?;

        // Try v1 (proto2) first — fails reliably on v2 files due to required fields
        match SlideSegmentationData::decode(&*bytes) {
            Ok(data) => {
                debug!("Decoded overlay as v1 format: {}", path.display());
                return Ok(data);
            }
            Err(v1_err) => {
                debug!(
                    "v1 decode failed for {}, trying v2: {}",
                    path.display(),
                    v1_err
                );

                // Try v2 (proto3) decode + convert
                match super::proto_v2::SlideSegmentationData::decode(&*bytes) {
                    Ok(v2_data) => {
                        debug!("Decoded overlay as v2 format: {}", path.display());
                        return reader_v2::convert_to_v1(&v2_data);
                    }
                    Err(v2_err) => {
                        return Err(OverlayError::ParseError(format!(
                            "Failed to decode protobuf (v1: {}, v2: {})",
                            v1_err, v2_err
                        )));
                    }
                }
            }
        }
    }
}

/// JSON reader (stub for future implementation)
pub struct JsonReader;

impl AnnotationReader for JsonReader {
    fn can_read(&self, path: &Path) -> bool {
        matches!(path.extension().and_then(|e| e.to_str()), Some("json"))
    }

    fn read(&self, _path: &Path) -> Result<SlideSegmentationData, OverlayError> {
        Err(OverlayError::UnsupportedFormat(
            "JSON format not yet implemented".into(),
        ))
    }
}

/// Composite reader that tries multiple readers in sequence
pub struct CompositeReader {
    readers: Vec<Box<dyn AnnotationReader>>,
}

impl CompositeReader {
    /// Create a new composite reader with default readers
    pub fn new() -> Self {
        Self {
            readers: vec![Box::new(ProtobufReader), Box::new(JsonReader)],
        }
    }

    /// Find a reader that can handle the given file
    pub fn find_reader(&self, path: &Path) -> Option<&dyn AnnotationReader> {
        self.readers.iter().find(|r| r.can_read(path)).map(|r| &**r)
    }
}

impl Default for CompositeReader {
    fn default() -> Self {
        Self::new()
    }
}

impl AnnotationReader for CompositeReader {
    fn can_read(&self, path: &Path) -> bool {
        self.readers.iter().any(|r| r.can_read(path))
    }

    fn read(&self, path: &Path) -> Result<SlideSegmentationData, OverlayError> {
        self.find_reader(path)
            .ok_or_else(|| {
                OverlayError::UnsupportedFormat(format!(
                    "No reader available for file: {}",
                    path.display()
                ))
            })?
            .read(path)
    }
}
