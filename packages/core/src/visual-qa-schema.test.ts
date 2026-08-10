import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { VisualQAPacketSchema, VisualQAReportSchema } from './visual-qa.js';

const repository = path.resolve(process.cwd(), '../..');

test('published visual QA schema exposes packet/report v1 shapes', async () => {
  const published = JSON.parse(await fs.readFile(path.join(repository, 'schemas', 'visual-qa.schema.json'), 'utf8'));
  assert.equal(published.oneOf.length, 2);
  assert.equal(published.$defs.packet.properties.schemaVersion.const, 1);
  assert.equal(published.$defs.report.properties.schemaVersion.const, 1);
  assert.deepEqual(published.$defs.source.properties.format.enum, ['png', 'gif', 'mp4']);
  assert.deepEqual(published.$defs.report.properties.verdict.enum, ['pending', 'pass', 'needs-changes']);
  assert.equal(VisualQAPacketSchema.safeParse({}).success, false);
  assert.equal(VisualQAReportSchema.safeParse({}).success, false);
});
