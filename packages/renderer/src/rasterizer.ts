import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';

const FONT_CANDIDATES = [
  { family: 'Consolas', files: ['C:\\Windows\\Fonts\\consola.ttf', 'C:\\Windows\\Fonts\\consolab.ttf'] },
  { family: 'DejaVu Sans Mono', files: ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'] },
  { family: 'Liberation Mono', files: ['/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf', '/usr/share/fonts/truetype/liberation2/LiberationMono-Bold.ttf'] },
] as const;

function fontOptions() {
  for (const candidate of FONT_CANDIDATES) {
    const files = candidate.files.filter((file) => existsSync(file));
    if (files.length > 0) {
      return {
        loadSystemFonts: false,
        fontFiles: files,
        defaultFontFamily: candidate.family,
        monospaceFamily: candidate.family,
      };
    }
  }
  return { loadSystemFonts: true, defaultFontFamily: 'monospace', monospaceFamily: 'monospace' };
}

export type RasterImage = {
  png: Buffer;
  width: number;
  height: number;
};

export interface Rasterizer {
  rasterize(svg: string): RasterImage;
}

export class ResvgRasterizer implements Rasterizer {
  rasterize(svg: string): RasterImage {
    const rendered = new Resvg(svg, {
      font: {
        ...fontOptions(),
      },
      shapeRendering: 2,
      textRendering: 1,
      imageRendering: 0,
    }).render();
    return { png: rendered.asPng(), width: rendered.width, height: rendered.height };
  }
}
