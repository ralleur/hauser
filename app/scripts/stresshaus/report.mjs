/* Befunde des Zwei-Tage-Laufs als Issues im privaten Repo (Label „stresshaus").

   Ein Befund, ein Issue — erkannt am Titel. Taucht ein offener Befund wieder
   auf, bekommt sein Issue einen Vermerk statt eines Zwillings; bleibt er aus,
   ebenfalls (schließen entscheidet die Sitzung, die ihn behebt: eine andere
   Startzahl kann ihn schlicht nicht getroffen haben). Die Sitzung liest die
   offenen Issues beim Start (CLAUDE.md) und behandelt sie wie Fremd-Issues.

     node scripts/stresshaus/report.mjs <bericht.json> [--kein-issue] */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = process.env.STRESSHAUS_ISSUE_REPO ?? 'ralleur/smart-home-hmi';
const LABEL = 'stresshaus';
const file = process.argv[2];
const dryRun = process.argv.includes('--kein-issue');
const report = JSON.parse(readFileSync(file, 'utf8'));
const date = new Date().toISOString().slice(0, 10);
const seedLine = report.seed === null || report.seed === undefined ? 'ohne Startzahl' : `Startzahl ${report.seed}`;

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const titleOf = (finding) => `Stresshaus: ${finding.key.replace(/\s+/g, ' ').slice(0, 90)}`;

const findings = report.findings ?? [];
console.log(`${date}, ${seedLine}: ${findings.length} Befunde`);
if (dryRun) { for (const f of findings) console.log(`- ${titleOf(f)}`); process.exit(0); }

gh('label', 'create', LABEL, '--repo', REPO, '--color', 'B60205', '--description', 'Befund des Stresshaus-Laufs', '--force');
const open = JSON.parse(gh('issue', 'list', '--repo', REPO, '--label', LABEL, '--state', 'open', '--limit', '200', '--json', 'number,title'));

const seen = new Set();
for (const finding of findings) {
  const title = titleOf(finding);
  seen.add(title);
  const existing = open.find((issue) => issue.title === title);
  const details = [
    `**Schritt:** ${finding.step}`,
    `**Art:** ${finding.kind} (${finding.count}× in diesem Lauf)`,
    '',
    '```',
    finding.text,
    '```',
    '',
    `Lauf ${date}, ${seedLine}, Sprache ${report.locale ?? 'de'}, Panel ${report.panelSize?.width}×${report.panelSize?.height}, Telefon ${report.phoneSize?.width}×${report.phoneSize?.height}.`,
    report.scenarios?.length ? `Ausgedachte Szenarien im Lauf: ${report.scenarios.join(' · ')}` : '',
    '',
    `Nachstellen: \`cd app && npm run build && node scripts/stresshaus/crawl.mjs --dev${report.seed === null || report.seed === undefined ? '' : ` --seed=${report.seed}`} --szenarien="$HOME/Library/Application Support/Hauser/stresshaus/szenarien"\``,
    '',
    'Beim Beheben: den Fall fest ins Stresshaus übernehmen (`app/src/lib/stresshaus/hostile-home.ts`) und das Gegenstück prüfen — derselbe Fehler in der anderen App (Web ↔ iOS)? Dann schließen.',
  ].filter((line) => line !== null).join('\n');
  if (existing) {
    gh('issue', 'comment', String(existing.number), '--repo', REPO, '--body', `Wieder aufgetreten.\n\n${details}`);
    console.log(`#${existing.number} wieder: ${title}`);
  } else {
    const url = gh('issue', 'create', '--repo', REPO, '--label', LABEL, '--title', title, '--body', details).trim();
    console.log(`neu ${url}: ${title}`);
  }
}
for (const issue of open) {
  if (seen.has(issue.title)) continue;
  gh('issue', 'comment', String(issue.number), '--repo', REPO, '--body', `Im Lauf ${date} (${seedLine}) nicht aufgetreten.`);
}
