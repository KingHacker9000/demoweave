import type { TerminalFrameModel, TerminalLayout, TerminalLine, TerminalTextRun } from './model.js';

const FONT_FAMILY = "'Cascadia Mono','Segoe UI Mono',Consolas,'Liberation Mono','DejaVu Sans Mono',monospace";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function streamColor(run: TerminalTextRun): string {
  if (run.style.foreground) return run.style.foreground;
  if (run.stream === 'input') return '#7dd3fc';
  if (run.stream === 'stderr') return '#fdba74';
  return '#e5e7eb';
}

export function createTerminalLayout(columns: number, terminalRows: number, finalRows: TerminalLine[]): TerminalLayout {
  const maximumCells = finalRows.reduce((maximum, line) => Math.max(maximum, line.cells), 0);
  const semanticColumns = Math.min(columns, Math.max(72, maximumCells));
  const width = Math.round(clamp(semanticColumns * 12 + 156, 920, 1_080));
  const cardX = 28;
  const cardY = 28;
  const cardWidth = width - cardX * 2;
  const contentX = cardX + 38;
  const contentWidth = cardWidth - 76;
  const cellWidth = Math.min(11.5, contentWidth / semanticColumns);
  const fontSize = clamp(cellWidth / 0.61, 15, 19);
  const lineHeight = Math.ceil(fontSize * 1.55);
  const visibleRows = Math.min(terminalRows, Math.max(10, finalRows.length));
  const contentY = cardY + 58 + 42;
  const cardHeight = 58 + 34 + visibleRows * lineHeight + 38;
  const height = cardY * 2 + cardHeight;
  return {
    width,
    height,
    cardX,
    cardY,
    cardWidth,
    cardHeight,
    contentX,
    contentY,
    contentWidth,
    lineHeight,
    fontSize,
    cellWidth,
    visibleRows,
  };
}

export function renderTerminalSvg(frame: TerminalFrameModel, layout: TerminalLayout): string {
  const lines = frame.rows.slice(-layout.visibleRows);
  const text: string[] = [];
  for (let row = 0; row < lines.length; row += 1) {
    let column = 0;
    for (const run of lines[row]!.runs) {
      const x = layout.contentX + column * layout.cellWidth;
      const y = layout.contentY + row * layout.lineHeight;
      const weight = run.style.bold || run.stream === 'input' ? 700 : 400;
      const opacity = run.style.dim ? 0.58 : 1;
      text.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="${streamColor(run)}" font-family="${FONT_FAMILY}" font-size="${layout.fontSize.toFixed(2)}" font-weight="${weight}" opacity="${opacity}" xml:space="preserve">${escapeXml(run.text)}</text>`);
      column += Array.from(run.text).length;
    }
  }

  const bodyTop = layout.cardY + 58;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    '<defs>',
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#020617" flood-opacity="0.38"/></filter>',
    `<clipPath id="body"><rect x="${layout.cardX}" y="${bodyTop}" width="${layout.cardWidth}" height="${layout.cardHeight - 58}" rx="0"/></clipPath>`,
    '</defs>',
    `<rect width="${layout.width}" height="${layout.height}" fill="#0b1020"/>`,
    `<rect x="${layout.cardX}" y="${layout.cardY}" width="${layout.cardWidth}" height="${layout.cardHeight}" rx="14" fill="#111827" stroke="#283449" stroke-width="1" filter="url(#shadow)"/>`,
    `<path d="M ${layout.cardX} ${bodyTop} H ${layout.cardX + layout.cardWidth}" stroke="#263244" stroke-width="1"/>`,
    `<circle cx="${layout.cardX + 26}" cy="${layout.cardY + 29}" r="6" fill="#fb7185"/>`,
    `<circle cx="${layout.cardX + 47}" cy="${layout.cardY + 29}" r="6" fill="#fbbf24"/>`,
    `<circle cx="${layout.cardX + 68}" cy="${layout.cardY + 29}" r="6" fill="#4ade80"/>`,
    `<text x="${layout.cardX + layout.cardWidth - 26}" y="${layout.cardY + 35}" text-anchor="end" fill="#94a3b8" font-family="Inter,'Segoe UI',sans-serif" font-size="15" font-weight="600" letter-spacing="0.3">DemoWeave</text>`,
    `<g clip-path="url(#body)">${text.join('')}</g>`,
    '</svg>',
  ].join('');
}
