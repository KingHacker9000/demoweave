# Renderer dependency decisions

The M4 terminal renderer and M8 compositor keep media concerns headless and narrow:

- `@resvg/resvg-js` rasterizes the terminal renderer's static SVG frame model to PNG. It is a focused SVG renderer with prebuilt Node binaries for supported Windows, Linux, and macOS targets, so rendering does not require Chromium, Electron, a browser runtime, or a platform graphics toolchain. The rasterizer loads a known native monospace font file when one is available (Consolas on Windows, DejaVu/Liberation Mono on Linux) and only falls back to system font discovery when necessary.
- FFmpeg is discovered at runtime and invoked with process argument arrays and `shell: false`. It remains optional to DemoWeave overall, is required for M4 animated GIF output, and is required for M8 MP4/GIF composition.
- The M8 compositor compiles semantic TimelinePlan layout, fit, duration, and cut operations into an internal FFmpeg filter graph. TimelinePlan v1 never accepts arbitrary filters or shell fragments.
- ANSI parsing is implemented as a small renderer-local safe subset for current pipe-mode tracks. Unsupported control sequences are consumed instead of displayed. A general terminal emulator dependency would add substantially more behavior than M4 needs.

Terminal replay, presentation, source resolution, layout compilation, and media encoding remain separate. Composition sits above existing source renderers and does not put FFmpeg inside TerminalReplay or WebDriver.
