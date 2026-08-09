import type { TerminalTextStyle } from './model.js';

export type TerminalToken =
  | { type: 'text'; text: string; style: TerminalTextStyle }
  | { type: 'newline' }
  | { type: 'carriageReturn' }
  | { type: 'tab' };

const basicColors = [
  '#1f2937', '#f87171', '#86efac', '#facc15',
  '#60a5fa', '#c084fc', '#67e8f9', '#e5e7eb',
] as const;

const brightColors = [
  '#6b7280', '#fca5a5', '#bbf7d0', '#fde68a',
  '#93c5fd', '#d8b4fe', '#a5f3fc', '#f9fafb',
] as const;

function component(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

function indexedColor(index: number): string | undefined {
  if (index >= 0 && index < 8) return basicColors[index];
  if (index >= 8 && index < 16) return brightColors[index - 8];
  if (index >= 16 && index <= 231) {
    const value = index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const red = levels[Math.floor(value / 36)]!;
    const green = levels[Math.floor((value % 36) / 6)]!;
    const blue = levels[value % 6]!;
    return `#${component(red)}${component(green)}${component(blue)}`;
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `#${component(gray)}${component(gray)}${component(gray)}`;
  }
  return undefined;
}

function applySgr(style: TerminalTextStyle, parameterText: string): TerminalTextStyle {
  const parameters = parameterText === ''
    ? [0]
    : parameterText.split(';').map((value) => value === '' ? 0 : Number(value));
  let next = { ...style };
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    if (parameter === undefined || !Number.isInteger(parameter)) continue;
    if (parameter === 0) next = {};
    else if (parameter === 1) next.bold = true;
    else if (parameter === 2) next.dim = true;
    else if (parameter === 22) {
      delete next.bold;
      delete next.dim;
    } else if (parameter >= 30 && parameter <= 37) next.foreground = basicColors[parameter - 30];
    else if (parameter === 39) delete next.foreground;
    else if (parameter >= 90 && parameter <= 97) next.foreground = brightColors[parameter - 90];
    else if (parameter === 38 && parameters[index + 1] === 5) {
      const color = indexedColor(parameters[index + 2] ?? -1);
      if (color) next.foreground = color;
      index += 2;
    } else if (parameter === 38 && parameters[index + 1] === 2) {
      const red = parameters[index + 2];
      const green = parameters[index + 3];
      const blue = parameters[index + 4];
      if ([red, green, blue].every((value) => Number.isInteger(value) && value! >= 0 && value! <= 255)) {
        next.foreground = `#${component(red!)}${component(green!)}${component(blue!)}`;
      }
      index += 4;
    }
  }
  return next;
}

function isFinalCsiByte(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function stringControlEnd(data: string, start: number): number | undefined {
  let index = start;
  while (index < data.length) {
    if (data[index] === '\u0007') return index + 1;
    if (data[index] === '\u009c') return index + 1;
    if (data[index] === '\u001b' && data[index + 1] === '\\') return index + 2;
    index += 1;
  }
  return undefined;
}

export class AnsiTokenizer {
  private style: TerminalTextStyle = {};
  private pending = '';

  parse(data: string): TerminalToken[] {
    const input = this.pending + data;
    this.pending = '';
    const tokens: TerminalToken[] = [];
    let text = '';
    const flush = () => {
      if (!text) return;
      tokens.push({ type: 'text', text, style: { ...this.style } });
      text = '';
    };

    let index = 0;
    while (index < input.length) {
      const character = input[index]!;
      if (character === '\u001b') {
        flush();
        const introducer = input[index + 1];
        if (!introducer) {
          this.pending = input.slice(index);
          break;
        }
        if (introducer === '[') {
          let end = index + 2;
          while (end < input.length && !isFinalCsiByte(input[end]!)) end += 1;
          if (end >= input.length) {
            this.pending = input.slice(index);
            break;
          }
          if (input[end] === 'm') this.style = applySgr(this.style, input.slice(index + 2, end));
          index = end + 1;
          continue;
        }
        if (introducer === ']' || introducer === 'P' || introducer === '^' || introducer === '_') {
          const end = stringControlEnd(input, index + 2);
          if (end === undefined) {
            this.pending = input.slice(index);
            break;
          }
          index = end;
          continue;
        }
        index += Math.min(2, input.length - index);
        continue;
      }
      if (character === '\u009b') {
        flush();
        let end = index + 1;
        while (end < input.length && !isFinalCsiByte(input[end]!)) end += 1;
        if (end >= input.length) {
          this.pending = input.slice(index);
          break;
        }
        if (input[end] === 'm') this.style = applySgr(this.style, input.slice(index + 1, end));
        index = end + 1;
        continue;
      }
      if (character === '\u009d' || character === '\u0090' || character === '\u0098' || character === '\u009e' || character === '\u009f') {
        flush();
        const end = stringControlEnd(input, index + 1);
        if (end === undefined) {
          this.pending = input.slice(index);
          break;
        }
        index = end;
        continue;
      }
      if (character === '\n') {
        flush();
        tokens.push({ type: 'newline' });
      } else if (character === '\r') {
        flush();
        tokens.push({ type: 'carriageReturn' });
      } else if (character === '\t') {
        flush();
        tokens.push({ type: 'tab' });
      } else {
        const code = character.charCodeAt(0);
        if ((code >= 0x20 && code !== 0x7f) || code >= 0xa0) text += character;
      }
      index += 1;
    }
    flush();
    return tokens;
  }
}
