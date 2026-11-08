// Writes the demo lead lists to examples/ so the CLI can be tried on them.
import { writeFileSync } from 'node:fs';
import { sampleFiles } from '../src/samples';

const { before, after } = sampleFiles();
writeFileSync('examples/leads_v1.csv', await before.text());
writeFileSync('examples/leads_final.csv', await after.text());
