# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@imgly/psd-importer`, a TypeScript library that imports Adobe Photoshop (PSD) files into the Creative Editor SDK ecosystem. The library converts PSD layers into CE.SDK blocks while preserving positioning, styling, and visual properties.

## Development Commands

```bash
# Install dependencies
npm install

# Build the project (copies assets and builds with ESBuild)
npm run build

# Run tests with Mocha
npm test

# Download example PSD files from Google Cloud Storage (requires access)
npm run download-example-files

# Run comparison tests
npm run compare

# Publish to npm (builds first)
npm run publish
```

## Code Architecture

### Core Components

**PSDParser Class** (`src/lib/psd-parser/index.ts`): Main orchestrator that:
- Parses PSD files using `@imgly/psd` library (a fork of `@webtoon/psd` with latest commits and PSB support)
- Converts PSD layers to CE.SDK blocks (text, graphic, image)
- Handles coordinate system transformations
- Manages font resolution via Google Fonts
- Processes clipping masks and blend modes

**Platform-Specific Modules**:
- `image-encoder-browser.ts` and `image-encoder-node.ts`: Handle PNG encoding for different environments
- Dual build targets: CommonJS (Node.js) and ESM (browser)

**Supporting Modules**:
- `font-resolver.ts`: Google Fonts API integration with fallback handling
- `color.ts`: RGBA/CMYK color space conversions
- `utils.ts`: Transform calculations and helper functions
- `logger.ts`: Configurable logging system

### Layer Processing Flow

1. Parse PSD file structure and extract layer data
2. Process layers recursively (supports nested groups)
3. Convert layer properties to CE.SDK format:
   - Text layers → text blocks with typography
   - Image layers → graphic blocks with image fills
   - Vector shapes → graphic blocks with vector paths
   - Groups → maintained as CE.SDK groups
4. Apply transforms, clipping masks, and blend modes
5. Resolve fonts and encode images for target platform

### Key Patterns

- **Transform Handling**: Converts PSD's top-left origin to CE.SDK's center-based positioning
- **Font Matching**: Attempts Google Fonts matching with configurable fallbacks
- **Error Handling**: Comprehensive logging with configurable levels
- **Platform Abstraction**: Uses conditional imports for browser/Node.js compatibility

## Testing

Tests are located in `src/test/` and process real PSD files from `src/test/examples/`. The test suite validates:
- Layer parsing accuracy
- Transform calculations
- Font resolution
- Output format compliance

Run individual tests by specifying the test file with Mocha's file pattern matching.

## Build System

Uses ESBuild with TypeScript definitions generated via `dts-bundle-generator`. The build process:
1. Copies static assets from `assets/` to `dist/`
2. Builds dual output (CommonJS + ESM)
3. Generates TypeScript declaration files
4. Maintains platform-specific imports

## Supported Features vs Limitations

The library supports most common PSD features (positioning, rotation, basic text, images, shapes) but has documented limitations around advanced text formatting, certain blend modes, and complex effects. Refer to README.md for the complete feature matrix.