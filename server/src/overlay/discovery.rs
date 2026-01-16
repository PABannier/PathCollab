//! Overlay discovery service
//!
//! Discovers overlay files for slides using multiple patterns:
//! - `<overlay_dir>/<slide_name>/overlays.bin`
//! - `<overlay_dir>/<slide_name>/cell_masks.bin`
//! - `<overlay_dir>/<slide_name>.<ext>/overlays.bin` (where ext is svs, tif, etc.)
//! - `<overlay_dir>/<slide_name>.<ext>/cell_masks.bin`

use std::path::{Path, PathBuf};
use tracing::debug;

/// Supported overlay file names (in order of preference)
const OVERLAY_FILE_NAMES: &[&str] = &["overlays.bin", "cell_masks.bin"];

/// Common slide file extensions to try when matching directories
const SLIDE_EXTENSIONS: &[&str] = &["svs", "tif", "tiff", "ndpi", "mrxs", "scn", "vms"];

/// Result of overlay discovery
#[derive(Debug, Clone)]
pub struct OverlayInfo {
    /// Path to the overlay file
    pub path: PathBuf,
    /// Slide ID this overlay belongs to
    pub slide_id: String,
    /// File size in bytes
    pub file_size: u64,
}

/// Check if an overlay exists for a given slide
///
/// Tries multiple patterns:
/// 1. `<overlay_dir>/<slide_id>/overlays.bin`
/// 2. `<overlay_dir>/<slide_id>/cell_masks.bin`
/// 3. `<overlay_dir>/<slide_id>.<ext>/overlays.bin` for common extensions
/// 4. `<overlay_dir>/<slide_id>.<ext>/cell_masks.bin` for common extensions
///
/// # Arguments
/// * `overlay_dir` - Base directory containing overlay folders
/// * `slide_id` - ID of the slide (usually filename without extension)
///
/// # Returns
/// * `Some(OverlayInfo)` if overlay exists
/// * `None` if no overlay found
pub fn check_overlay_exists(overlay_dir: &Path, slide_id: &str) -> Option<OverlayInfo> {
    // Try all combinations of directory names and file names
    let dir_patterns: Vec<String> = {
        let mut patterns = vec![slide_id.to_string()];
        // Also try with common extensions appended
        for ext in SLIDE_EXTENSIONS {
            patterns.push(format!("{}.{}", slide_id, ext));
        }
        patterns
    };

    for dir_name in &dir_patterns {
        for file_name in OVERLAY_FILE_NAMES {
            let overlay_path = overlay_dir.join(dir_name).join(file_name);
            if overlay_path.exists() && overlay_path.is_file() {
                let file_size = std::fs::metadata(&overlay_path)
                    .map(|m| m.len())
                    .unwrap_or(0);

                debug!(
                    "Found overlay for slide '{}' at {:?} ({} bytes)",
                    slide_id, overlay_path, file_size
                );

                return Some(OverlayInfo {
                    path: overlay_path,
                    slide_id: slide_id.to_string(),
                    file_size,
                });
            }
        }
    }

    debug!("No overlay found for slide '{}' in {:?}", slide_id, overlay_dir);
    None
}

/// Get the expected overlay path for a slide (primary pattern)
///
/// # Arguments
/// * `overlay_dir` - Base directory containing overlay folders
/// * `slide_name` - Name of the slide (filename without extension)
///
/// # Returns
/// Path to where the overlay file should be located (primary pattern)
pub fn get_overlay_path(overlay_dir: &Path, slide_name: &str) -> PathBuf {
    overlay_dir.join(slide_name).join("overlays.bin")
}

/// Strip known slide file extensions from a directory name to get the slide ID
fn strip_slide_extension(dir_name: &str) -> &str {
    for ext in SLIDE_EXTENSIONS {
        let suffix = format!(".{}", ext);
        if dir_name.ends_with(&suffix) {
            return &dir_name[..dir_name.len() - suffix.len()];
        }
    }
    dir_name
}

/// Discover all available overlays in the overlay directory
///
/// # Arguments
/// * `overlay_dir` - Base directory containing overlay folders
///
/// # Returns
/// Map of slide_id -> OverlayInfo for all discovered overlays
/// Note: slide_id is normalized (extension stripped from directory name)
pub fn discover_all_overlays(overlay_dir: &Path) -> std::collections::HashMap<String, OverlayInfo> {
    let mut overlays = std::collections::HashMap::new();

    if !overlay_dir.exists() || !overlay_dir.is_dir() {
        debug!("Overlay directory does not exist: {:?}", overlay_dir);
        return overlays;
    }

    // Scan subdirectories for overlay files
    if let Ok(entries) = std::fs::read_dir(overlay_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Extract slide name from directory name
                if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                    // Check for overlay files in this directory
                    for file_name in OVERLAY_FILE_NAMES {
                        let overlay_path = path.join(file_name);
                        if overlay_path.exists() && overlay_path.is_file() {
                            let file_size = std::fs::metadata(&overlay_path)
                                .map(|m| m.len())
                                .unwrap_or(0);

                            // Normalize slide ID by stripping extension from directory name
                            let slide_id = strip_slide_extension(dir_name);

                            debug!(
                                "Found overlay for slide '{}' (dir: '{}') at {:?} ({} bytes)",
                                slide_id, dir_name, overlay_path, file_size
                            );

                            overlays.insert(
                                slide_id.to_string(),
                                OverlayInfo {
                                    path: overlay_path,
                                    slide_id: slide_id.to_string(),
                                    file_size,
                                },
                            );
                            break; // Found overlay, move to next directory
                        }
                    }
                }
            }
        }
    }

    debug!("Discovered {} overlays in {:?}", overlays.len(), overlay_dir);
    overlays
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_get_overlay_path() {
        let overlay_dir = Path::new("/data/overlays");
        let path = get_overlay_path(overlay_dir, "slide_001");
        assert_eq!(path, PathBuf::from("/data/overlays/slide_001/overlays.bin"));
    }

    #[test]
    fn test_check_overlay_exists_not_found() {
        // Use a path that doesn't exist
        let result = check_overlay_exists(Path::new("/nonexistent/path"), "nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_check_overlay_exists_empty_dir() {
        // Use temp directory from std
        let temp_dir = std::env::temp_dir().join("pathcollab_test_overlay_empty");
        let _ = fs::remove_dir_all(&temp_dir); // Clean up if exists
        fs::create_dir_all(&temp_dir).unwrap();

        let result = check_overlay_exists(&temp_dir, "nonexistent_slide");
        assert!(result.is_none());

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_check_overlay_exists_found() {
        let temp_dir = std::env::temp_dir().join("pathcollab_test_overlay_found");
        let _ = fs::remove_dir_all(&temp_dir); // Clean up if exists

        // Create overlay directory structure
        let slide_dir = temp_dir.join("test_slide");
        fs::create_dir_all(&slide_dir).unwrap();

        // Create overlay file with some content
        let overlay_file = slide_dir.join("overlays.bin");
        fs::write(&overlay_file, b"test overlay content").unwrap();

        let result = check_overlay_exists(&temp_dir, "test_slide");
        assert!(result.is_some());

        let info = result.unwrap();
        assert_eq!(info.slide_id, "test_slide");
        assert_eq!(info.file_size, 20);

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_discover_all_overlays() {
        let temp_dir = std::env::temp_dir().join("pathcollab_test_overlay_discover");
        let _ = fs::remove_dir_all(&temp_dir); // Clean up if exists
        fs::create_dir_all(&temp_dir).unwrap();

        // Create multiple overlay directories
        for slide_name in &["slide_a", "slide_b", "slide_c"] {
            let slide_dir = temp_dir.join(slide_name);
            fs::create_dir_all(&slide_dir).unwrap();
            fs::write(slide_dir.join("overlays.bin"), b"test").unwrap();
        }

        // Create a directory without overlay file
        let empty_dir = temp_dir.join("slide_empty");
        fs::create_dir_all(&empty_dir).unwrap();

        let overlays = discover_all_overlays(&temp_dir);
        assert_eq!(overlays.len(), 3);
        assert!(overlays.contains_key("slide_a"));
        assert!(overlays.contains_key("slide_b"));
        assert!(overlays.contains_key("slide_c"));
        assert!(!overlays.contains_key("slide_empty"));

        // Clean up
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
