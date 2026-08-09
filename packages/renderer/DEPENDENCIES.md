# Renderer dependency decisions

The M4 terminal renderer keeps media concerns headless and narrow:

- `@resvg/resvg-js` rasterizes the renderer's static SVG frame model to PNG. It is a focused SVG renderer with prebuilt Node binaries for supported Windows, Linux, and macOS targets, so rendering does not require Chromium, Electron, a browser runtime, or a platform graphics toolchain. The rasterizer loads a known native monospace font file when one is available (Consolas on Windows, DejaVu/Liberation Mono on Linux) and only falls back to system font discovery when necessary.
- FFmpeg is discovered at runtime and invoked with process argument arrays. It is optional for PNG output and required only for animated GIF encoding.
- ANSI parsing is implemented as a small renderer-local safe subset for current pipe-mode tracks. Unsupported control sequences are consumed instead of displayed. A general terminal emulator dependency would add substantially more behavior than M4 needs.

The vector model, rasterizer, and media encoder remain separate so future renderers can reuse presentation data without putting FFmpeg inside terminal replay logic.
