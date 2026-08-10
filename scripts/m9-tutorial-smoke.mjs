import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..');
const cli = path.join(repository, 'packages', 'cli', 'dist', 'index.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demoweave-m9-smoke-'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function snapshot(paths) {
  const result = {};
  for (const file of paths) result[file] = sha256(await fs.readFile(path.join(root, file)));
  return result;
}

try {
  await fs.mkdir(path.join(root, '.demoweave', 'tutorials'), { recursive: true });
  await fs.mkdir(path.join(root, '.demoweave', 'evidence'), { recursive: true });
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.copyFile(path.join(repository, 'docs-media', 'terminal-web-proof.mp4'), path.join(root, 'media', 'proof.mp4'));
  await fs.writeFile(path.join(root, '.demoweave', 'config.json'), JSON.stringify({ schemaVersion: 1, mediaDir: 'output' }));
  await fs.writeFile(path.join(root, '.demoweave', 'tutorials', 'proof.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'proof',
    video: { evidenceId: 'proof-video' },
    metadata: {
      title: 'DemoWeave evidence proof',
      description: 'A deterministic package built from verified MP4 Evidence.',
      language: 'en',
      tags: ['documentation', 'developer-tools'],
    },
    thumbnail: {
      atMs: 2500,
      width: 640,
      height: 360,
      fit: 'cover',
      background: '#0b0d14',
      title: 'DemoWeave',
      subtitle: 'Evidence-driven tutorials',
    },
    captions: [
      { id: 'intro', startMs: 0, endMs: 2200, text: 'DemoWeave grounds documentation in runtime evidence.' },
      { id: 'proof', startMs: 2300, endMs: 4900, text: 'This tutorial package comes from real composed Evidence.' },
    ],
    chapters: [{ startMs: 0, title: 'Evidence proof' }],
  }));
  await fs.writeFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    projectProfileVersion: 1,
    flows: [],
    evidence: [{
      schemaVersion: 1,
      id: 'proof-video',
      kind: 'recording',
      status: 'available',
      format: 'mp4',
      path: 'media/proof.mp4',
      provenance: { sources: [] },
    }],
  }));

  const build = () => spawnSync(process.execPath, [cli, 'tutorial', 'build', 'proof', '--project', root], { encoding: 'utf8', shell: false });
  const first = build();
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /Tutorial: proof/);
  assert.match(first.stdout, /Source Evidence: proof-video/);
  assert.match(first.stdout, /Video: 1920x720, 5\.00s/);

  const base = 'output/tutorials/proof';
  const tracked = [
    `${base}/proof.mp4`,
    `${base}/proof-thumbnail.png`,
    `${base}/proof.srt`,
    `${base}/proof.vtt`,
    `${base}/proof-chapters.txt`,
    `${base}/proof-description.txt`,
    `${base}/proof-youtube.json`,
    '.demoweave/evidence/manifest.json',
  ];
  const thumbnail = await fs.readFile(path.join(root, `${base}/proof-thumbnail.png`));
  assert.deepEqual([...thumbnail.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(await fs.readFile(path.join(root, `${base}/proof.srt`), 'utf8'), /00:00:02,300 --> 00:00:04,900/);
  assert.match(await fs.readFile(path.join(root, `${base}/proof.vtt`), 'utf8'), /^WEBVTT/);
  assert.equal(await fs.readFile(path.join(root, `${base}/proof-chapters.txt`), 'utf8'), '0:00 Evidence proof\n');
  assert.match(await fs.readFile(path.join(root, `${base}/proof-description.txt`), 'utf8'), /Chapters\n0:00 Evidence proof/);
  const metadata = JSON.parse(await fs.readFile(path.join(root, `${base}/proof-youtube.json`), 'utf8'));
  assert.equal(metadata.sourceEvidenceId, 'proof-video');
  assert.deepEqual(metadata.video, { width: 1920, height: 720, durationMs: 5000 });

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path.join(root, `${base}/proof.mp4`)], { encoding: 'utf8', shell: false });
  assert.equal(probe.status, 0, probe.stderr);
  const details = JSON.parse(probe.stdout);
  assert.equal(details.streams[0].width, 1920);
  assert.equal(details.streams[0].height, 720);
  assert.ok(Number(details.format.duration) >= 4.99 && Number(details.format.duration) <= 5.01);

  const manifest = JSON.parse(await fs.readFile(path.join(root, '.demoweave', 'evidence', 'manifest.json'), 'utf8'));
  const tutorialEvidence = manifest.evidence.filter((item) => item.producer?.id === 'tutorial');
  assert.equal(tutorialEvidence.length, 7);
  assert.ok(tutorialEvidence.every((item) => item.derivedFrom?.length === 1 && item.derivedFrom[0] === 'proof-video'));
  assert.ok(tutorialEvidence.every((item) => /^sha256:[0-9a-f]{64}$/.test(item.artifactHash ?? '')));

  const before = await snapshot(tracked);
  const second = build();
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(await snapshot(tracked), before);

  console.log('M9 tutorial smoke passed: MP4 Evidence -> video + thumbnail + SRT/VTT + chapters + upload metadata with stable same-input output.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
