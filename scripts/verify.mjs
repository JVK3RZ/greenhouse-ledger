import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const pass = message => console.log(`✓ ${message}`);
const fail = message => failures.push(message);
const read = path => readFileSync(join(root, path), 'utf8');

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

const allFiles = walk(root);
const javascript = allFiles.filter(path => extname(path) === '.js');
for (const path of javascript) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    fail(`JavaScript syntax failed for ${relative(root, path)}: ${error.stderr?.toString().trim() || error.message}`);
  }
}
if (!failures.length) pass(`${javascript.length} JavaScript files pass syntax validation`);

const index = read('index.html');
const worker = read('service-worker.js');
const settings = read('settings.js');
const auth = read('auth.js');
const cloudLedger = read('cloud-ledger.js');
const invitationMigration = read('supabase/migrations/20260812150000_phase_13_team_invitations.sql');
const memberRepairMigration = read('supabase/migrations/20260812161500_prevent_invitation_member_downgrades.sql');
const onboardingMigration = read('supabase/migrations/20260812173000_phase_14_pilot_onboarding.sql');
const visualCatalogMigration = read('supabase/migrations/20260812184500_phase_15_visual_catalog.sql');
const stockCountMigration = read('supabase/migrations/20260812200000_phase_16_bulk_receiving_stock_counts.sql');
const stockCountHardeningMigration = read('supabase/migrations/20260812203000_harden_phase_16_count_access.sql');
const plantHealthMigration = read('supabase/migrations/20260812213000_phase_17_plant_health_issues.sql');
const catalogOnboarding = read('catalog-onboarding.js');
const invitationFunction = read('supabase/functions/send-organization-invitation/index.ts');
const localScripts = [...index.matchAll(/<script[^>]+src=["']\.\/([^"']+)["']/g)].map(match => match[1]);
const shellAssets = [...worker.matchAll(/["']\.\/([^"']+)["']/g)].map(match => match[1]).filter(path => path !== '');

for (const path of [...new Set([...localScripts, ...shellAssets])]) {
  if (!existsSync(join(root, path))) fail(`Referenced PWA asset is missing: ${path}`);
}
for (const script of localScripts) {
  if (!shellAssets.includes(script)) fail(`Local script is not cached by the service worker: ${script}`);
}
if (!failures.length) pass('PWA shell references exist and local scripts are cached');

if (/function\s+render\s*\(/.test(settings)) {
  fail('Settings must not shadow the main application render function');
} else if (!/function\s+open\s*\([^)]*\)\s*\{[^}]*activeTab\s*=\s*['"]settings['"][^}]*render\s*\(\s*\)/s.test(settings)) {
  fail('Settings navigation must route through the main application renderer');
} else if (!/render\s*:\s*renderMarkup/.test(settings)) {
  fail('Settings must expose its HTML renderer as Settings.render');
} else {
  pass('Settings dropdown navigation routes through the main application renderer');
}

if (!/get_organization_invitation_details/.test(auth) || !/emailRedirectTo\s*:\s*window\.location\.href/.test(auth)) {
  fail('Invitation acceptance must preview safely and survive email confirmation');
} else if (!/Create owner account/.test(auth) || !/Create account & accept/.test(auth)) {
  fail('Owner-first and invited-staff onboarding must remain distinct');
} else if (!/revoke_organization_invitation/.test(cloudLedger) || !/send-organization-invitation/.test(cloudLedger)) {
  fail('Team invitation controls must use the protected lifecycle endpoints');
} else if (!/revoked_at is null and expires_at>now\(\)/.test(invitationMigration) || !/drop policy if exists invitations_update/.test(invitationMigration)) {
  fail('Invitation migration must reject revoked/expired links and block arbitrary row updates');
} else if (!/SUPABASE_SERVICE_ROLE_KEY/.test(invitationFunction) || !/Owner or manager access required/.test(invitationFunction) || !/RESEND_API_KEY/.test(invitationFunction)) {
  fail('Invitation email delivery must authenticate managers and keep provider secrets server-side');
} else {
  pass('Owner-first invitation lifecycle and server-side email boundaries are enforced');
}

if (!/if\(error\)return showToast\(error\.message\)/.test(cloudLedger)) {
  fail('Invitation form must display database membership-protection errors');
} else if (!/already belongs to this organization/.test(memberRepairMigration) || /on conflict[\s\S]*do update set role/i.test(memberRepairMigration)) {
  fail('Invitation acceptance must reject existing members without rewriting their role');
} else if (!/prevent_duplicate_member_invitation/.test(memberRepairMigration)) {
  fail('Invitation insertion must enforce duplicate-member protection in the database');
} else {
  pass('Existing members cannot be invited, downgraded, or reassigned through invitations');
}

if (!/Owner setup/.test(cloudLedger) || !/Load demo greenhouse/.test(cloudLedger) || !/Invitation accepted/.test(cloudLedger)) {
  fail('Phase 14 must include owner setup, guarded demo loading, and staff first-login guidance');
} else if (!/member\.role = 'owner'/.test(onboardingMigration) || !/Demo data can only be loaded into an empty workspace/.test(onboardingMigration)) {
  fail('Demo greenhouse seeding must be owner-only and limited to empty workspaces');
} else if (!/security invoker/.test(onboardingMigration) || /security definer/.test(onboardingMigration)) {
  fail('Demo greenhouse seeding must preserve caller RLS through security invoker');
} else {
  pass('Pilot onboarding and demonstration data are role-aware and safely guarded');
}

if (!/Add one plant/.test(catalogOnboarding) || !/Choose starter plants/.test(catalogOnboarding) || !/Import spreadsheet/.test(catalogOnboarding)) {
  fail('Phase 15 must offer three plain-language catalog setup paths');
} else if (!/A CSV is a simple spreadsheet file/.test(catalogOnboarding) || !/container_size/.test(catalogOnboarding)) {
  fail('Spreadsheet import must explain CSV and support sellable container sizes');
} else if (!/status in \('active','archived'\)/.test(visualCatalogMigration) || !/filter\(item=>item\.status!==['"]archived['"]\)/.test(cloudLedger)) {
  fail('Archived catalog products must remain stored but unavailable for new inventory');
} else {
  pass('Visual catalog setup, starter products, and spreadsheet import are approachable and lifecycle-aware');
}

if (!/Bulk receiving/.test(cloudLedger) || !/Physical stock count/.test(cloudLedger) || !/Approve adjustments/.test(cloudLedger)) {
  fail('Phase 16 must include bulk receiving and an approval-based physical count workflow');
} else if ((stockCountMigration.match(/security definer/g)||[]).length !== 5 || !/revoke all on function public\.finalize_inventory_count/.test(stockCountMigration)) {
  fail('Phase 16 mutation functions must be explicitly permissioned and keep count tables read-only to clients');
} else if (!/profile_id = \(select auth\.uid\(\)\)/.test(stockCountMigration) || !/role in \('owner','manager'\)/.test(stockCountMigration)) {
  fail('Phase 16 privileged functions must authenticate organization membership and approval roles internally');
} else if (!/Every batch must be counted before approval/.test(stockCountMigration) || !/Owner or manager approval required/.test(stockCountMigration)) {
  fail('Physical stock counts must be complete and manager-approved before quantities change');
} else if (!/Bulk receipt must contain between 1 and 100 items/.test(stockCountMigration) || !/inventory_count_completed/.test(stockCountMigration)) {
  fail('Bulk receiving must be bounded and completed counts must leave an activity record');
} else if (!/revoke all on table public\.inventory_counts, public\.inventory_count_lines from public, anon, authenticated/.test(stockCountHardeningMigration) || !/grant select on table public\.inventory_counts, public\.inventory_count_lines to authenticated/.test(stockCountHardeningMigration)) {
  fail('Physical count tables must be explicitly read-only through the Data API');
} else if ((stockCountHardeningMigration.match(/create index inventory_count/g)||[]).length !== 5) {
  fail('Phase 16 staff and location foreign keys must have covering indexes');
} else {
  pass('Bulk receiving and physical stock counts are atomic, auditable, and approval-controlled');
}

if (!/Plant health &amp; issues/.test(cloudLedger) || !/Report an observation/.test(cloudLedger) || !/Save follow-up/.test(cloudLedger)) {
  fail('Phase 17 must provide plant-health reporting, status tracking, and follow-up notes');
} else if (!/batch_id is not null or location_id is not null/.test(plantHealthMigration) || !/Choose a batch or production zone/.test(plantHealthMigration)) {
  fail('Plant-health issues must be attached to an organization-owned batch or production zone');
} else if (!/revoke all on table public\.plant_health_issues, public\.plant_health_issue_updates from public, anon, authenticated/.test(plantHealthMigration) || !/grant select on table public\.plant_health_issues, public\.plant_health_issue_updates to authenticated/.test(plantHealthMigration)) {
  fail('Plant-health tables must be explicitly read-only through the Data API');
} else if ((plantHealthMigration.match(/security definer/g)||[]).length !== 3 || (plantHealthMigration.match(/Organization membership required/g)||[]).length !== 3) {
  fail('Plant-health mutation functions must enforce membership internally');
} else if (!/plant_health_issue_reported/.test(plantHealthMigration) || !/plant_health_issue_updated/.test(plantHealthMigration) || !/insert into public\.plant_health_issue_updates/.test(plantHealthMigration)) {
  fail('Plant-health reports and follow-ups must preserve audit history');
} else if (!/organizationId\(\)\}\/issues/.test(cloudLedger) || !/Photo path must belong to this issue/.test(plantHealthMigration)) {
  fail('Issue photos must use the organization- and issue-scoped storage path');
} else {
  pass('Plant-health observations, protected photos, and append-only follow-up history are organization-scoped');
}

const manifest = JSON.parse(read('manifest.webmanifest'));
if (!manifest.name || !manifest.short_name || !Array.isArray(manifest.icons) || manifest.icons.length < 2) {
  fail('Web app manifest must include names and at least two icons');
} else {
  for (const icon of manifest.icons) {
    const path = String(icon.src || '').replace(/^\.\//, '');
    if (!path || !existsSync(join(root, path))) fail(`Manifest icon is missing: ${icon.src || '(empty)'}`);
  }
  if (!failures.length) pass('Web app manifest and icons are complete');
}

const migrationsDirectory = join(root, 'supabase', 'migrations');
if (!existsSync(migrationsDirectory)) {
  fail('Supabase migrations directory is missing');
} else {
  const migrations = readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
  const versions = new Set();
  for (const name of migrations) {
    const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
    if (!match) fail(`Migration filename is not versioned correctly: ${name}`);
    else if (versions.has(match[1])) fail(`Duplicate migration version: ${match[1]}`);
    else versions.add(match[1]);
  }
  if (!failures.length) pass(`${migrations.length} Supabase migrations are ordered and uniquely versioned`);
}

const publicSource = allFiles.filter(path => {
  const rel = relative(root, path);
  return !rel.startsWith(`scripts${join('', 'x').slice(0, 0)}`) && ['.js', '.html', '.json', '.webmanifest'].includes(extname(path));
});
for (const path of publicSource) {
  const source = readFileSync(path, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]+/.test(source) || /SUPABASE_SERVICE_ROLE_KEY\s*[:=]/.test(source)) {
    fail(`Potential Supabase administrative secret found in ${relative(root, path)}`);
  }
}
if (!failures.length) pass('Public application files contain no Supabase administrative-key patterns');

if (failures.length) {
  console.error('\nQuality gate failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('\nGreenhouse Ledger quality gate passed.');
