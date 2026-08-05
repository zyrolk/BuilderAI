const stage = process.argv[2] ?? 'unknown';
const mode = process.env.BUILDERAI_VERIFY_MODE ?? 'pass';

if (mode === 'timeout') {
  setTimeout(() => process.exit(0), 60_000);
} else if (mode === 'infra') {
  throw new Error('Simulated infrastructure failure');
} else {
  const outcome = mode === 'pass' ? 0 : mode === stage ? 1 : 0;
  process.stdout.write(`${stage}-${outcome === 0 ? 'ok' : 'fail'}\n`);
  process.exit(outcome);
}
