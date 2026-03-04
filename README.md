# Wikipedia 3D Viewer

[![License: GPL-2.0-or-later](https://img.shields.io/badge/License-GPL--2.0--or--later-blue.svg)](https://www.gnu.org/licenses/gpl-2.0.html)
[![MediaWiki Version](https://img.shields.io/badge/MediaWiki-%3E%3D%201.45-orange.svg)](https://www.mediawiki.org/wiki/MediaWiki)

An improved 3D file viewer extension for MediaWiki, designed to support textured and animated 3D models on Wikipedia. This project is an evolution of the original [Extension:3D](https://www.mediawiki.org/wiki/Extension:3D).


[![Watch the demo](https://github.com/gabriel-lucas/wikipedia-3d-viewer/raw/main/images/triceratops.png)](https://github.com/gabriel-lucas/wikipedia-3d-viewer/releases/download/v1.0.0/Wikipedia.3D.Viewer.webm)

> [!NOTE]
> *If the video does not display, you can download it directly from the [latest release](https://github.com/gabriel-lucas/wikipedia-3d-viewer/releases).*

---

## Improvements over the Original Extension

This version introduces the following features:

| Feature | Original Extension | **Wikipedia 3D Viewer** |
| :--- | :---: | :---: |
| **File Formats** | STL only | **STL, GLB, GLTF (early support)** |
| **Materials** | Basic shading | **PBR (Physically Based Rendering)** |
| **Animations** | Not supported | **Full Animation Controller** |
| **Navigation** | Basic Orbit | **Smooth Easing + Click-to-Focus** |
| **Lighting** | Static | **Dynamic Headlights + Environment Maps** |
| **UI** | None / Static | **Floating Intelligent Toolbars** |
| **Compression** | None | **KTX2 & Meshopt Support** |

---

## Key Features

### Format Support
- **GLB / GLTF Support**: Support for the industry-standard "JPEG of 3D", allowing for textures, PBR materials and animations. GLTF is in early support.
- **Legacy STL Compatibility**: Support for STL files with custom lighting.
- **Optimized Performance**: **KTX2** support for compressed textures and **Meshopt** for geometry decrusting.

### Advanced Interactivity
- **Navigation**: Orbit controls with damping and easing.
- **Precision Focus**: Double-click or tap on any part of a model to smoothly zoom into that area (Click-to-Focus).
- **Smart Shortcuts**: Press `Space` to reset the camera to the optimal framing.
- **Panning Controls**: Use `Shift + Left Click` or `Middle/Right Click` for panning.

### Animation Toolbar
A control bar for animated models:
- **Play/Pause & Seek**: Interactive progress bar for control over animation timing.
- **Speed Control**: Adjust playback from 0.1x up to 2x.
- **Track Selection**: Switch between multiple animation clips contained within a file.
- **Loop Modes**: Support for "Repeat Single", "Repeat All", or "Play Once" modes.

### Professional UI & Workflow
- **Intelligent Toolbars**: Controls fade out when the user is inactive to provide an unobstructed view.
- **Settings Panel**: Toggle HD textures, enter full-screen mode, or reset the camera.
- **Enhanced Uploads**: Patent permission selector for 3D file uploads on the Special:Upload page.
- **Environmental Lighting**: Uses PMREM environment maps for realistic reflections and PBR material accuracy.

---

## Installation

1. **Prerequisites**: Ensure you are running **MediaWiki 1.45** or later.
2. **Download**: Clone this repository into your `extensions/` directory:
   ```bash
   cd extensions/
   git clone https://github.com/gabriel-lucas/wikipedia-3d-viewer.git 3D
   ```
3. **Activate**: Add the following line to your `LocalSettings.php`:
   ```php
   wfLoadExtension( '3D' );
   ```
4. **Configuration**: (Optional) You can customize memory limits in `LocalSettings.php`:
   ```php
   $wgMax3d2pngMemory = 10000000;
   ```

---

## Technical Details

This extension leverages a modern stack to ensure performance and reliability:
- **Three.js**: Upgraded to the latest stable versions (0.183.2).
- **PBR Materials**: Leverages standard materials for realistic lighting.
- **Debounced Resizing**: Ensures the viewer remains responsive without sacrificing performance.
- **Shadow Maps**: Dynamic shadows for increased depth perception.

## License

This project is licensed under the **GPL-2.0-or-later**, maintaining compatibility with the MediaWiki ecosystem. See the `COPYING` file for more details.
