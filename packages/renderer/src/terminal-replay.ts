import type { TerminalEventStream } from '@demoweave/core';
import { AnsiTokenizer } from './ansi.js';
import type { TerminalCell, TerminalLine, TerminalTextRun, TerminalTextStyle } from './model.js';

type MutableLine = Array<TerminalCell | undefined>;

function sameStyle(left: TerminalTextStyle, right: TerminalTextStyle): boolean {
  return left.foreground === right.foreground && left.bold === right.bold && left.dim === right.dim;
}

function lineToModel(line: MutableLine): TerminalLine {
  let length = line.length;
  while (length > 0 && !line[length - 1]) length -= 1;
  const runs: TerminalTextRun[] = [];
  for (let index = 0; index < length; index += 1) {
    const cell = line[index] ?? { character: ' ', stream: 'stdout' as const, style: {} };
    const previous = runs.at(-1);
    if (previous && previous.stream === cell.stream && sameStyle(previous.style, cell.style)) {
      previous.text += cell.character;
    } else {
      runs.push({ text: cell.character, stream: cell.stream, style: { ...cell.style } });
    }
  }
  return { cells: length, runs };
}

export class TerminalReplay {
  private readonly tokenizer = new AnsiTokenizer();
  private readonly lines: MutableLine[] = [[]];
  private row = 0;
  private column = 0;
  private commandOpen = false;

  constructor(private readonly columns: number, private readonly maximumRows: number) {}

  apply(stream: TerminalEventStream, data: string): void {
    if (stream === 'input' && !this.commandOpen) {
      this.commandOpen = true;
      this.writeText('input', '$ ', { bold: true });
    }

    for (const token of this.tokenizer.parse(data)) {
      if (token.type === 'text') this.writeText(stream, token.text, token.style);
      else if (token.type === 'newline') this.newline();
      else if (token.type === 'carriageReturn') this.column = 0;
      else if (token.type === 'tab') {
        const spaces = 4 - (this.column % 4);
        this.writeText(stream, ' '.repeat(spaces), {});
      }
      if (stream === 'input' && token.type === 'newline') this.commandOpen = false;
    }
  }

  snapshot(): TerminalLine[] {
    return this.lines.map(lineToModel);
  }

  private writeText(stream: TerminalEventStream, text: string, style: TerminalTextStyle): void {
    for (const character of text) {
      if (this.column >= this.columns) this.newline();
      this.lines[this.row]![this.column] = { character, stream, style: { ...style } };
      this.column += 1;
    }
  }

  private newline(): void {
    this.row += 1;
    this.column = 0;
    if (!this.lines[this.row]) this.lines.push([]);
    if (this.lines.length > this.maximumRows) {
      this.lines.shift();
      this.row -= 1;
    }
  }
}
