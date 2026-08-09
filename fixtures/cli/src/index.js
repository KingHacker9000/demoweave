#!/usr/bin/env node
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const stdout = valueAfter('--stdout');
const stderr = valueAfter('--stderr');
const envName = valueAfter('--env');
const delay = Number(valueAfter('--delay') ?? 0);
const exitCode = Number(valueAfter('--exit') ?? 0);

const finish = () => {
  if (stdout !== undefined) process.stdout.write(`${stdout}\n`);
  else process.stdout.write('fixture-cli ready\n');
  if (stderr !== undefined) process.stderr.write(`${stderr}\n`);
  if (envName !== undefined) process.stdout.write(`${envName}=${process.env[envName] ?? ''}\n`);
  if (args.includes('--print-args')) process.stdout.write(`${JSON.stringify(args)}\n`);
  if (args.includes('--ansi')) process.stdout.write('\u001b[31mred\u001b[0m\n');
  process.exitCode = exitCode;
};

if (delay > 0) setTimeout(finish, delay);
else finish();
