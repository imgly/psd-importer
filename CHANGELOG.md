# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2025-01-16

### Fixed

- Don't apply rotation to layers with skew/shear transforms. Previously, layers with skew transforms would have incorrect rotation applied. Now the importer detects skew transforms and logs a warning instead of applying incorrect rotation.
- Add guard against division by zero when processing degenerate transform matrices.
- Fix warning message to be layer-type agnostic (applies to text, image, and graphic blocks).

## [0.1.0] - 2025-01-10

### Added

- Use buffer URLs instead of blob URLs for transient resources.
- WOFF2 font support.

### Fixed

- Handle capacity overflow errors when processing large layer masks.
