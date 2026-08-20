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
const packageJson = JSON.parse(read('package.json'));
const auth = read('auth.js');
const cloudLedger = read('cloud-ledger.js');
const invitationMigration = read('supabase/migrations/20260812150000_phase_13_team_invitations.sql');
const memberRepairMigration = read('supabase/migrations/20260812161500_prevent_invitation_member_downgrades.sql');
const onboardingMigration = read('supabase/migrations/20260812173000_phase_14_pilot_onboarding.sql');
const visualCatalogMigration = read('supabase/migrations/20260812184500_phase_15_visual_catalog.sql');
const stockCountMigration = read('supabase/migrations/20260812200000_phase_16_bulk_receiving_stock_counts.sql');
const stockCountHardeningMigration = read('supabase/migrations/20260812203000_harden_phase_16_count_access.sql');
const plantHealthMigration = read('supabase/migrations/20260812213000_phase_17_plant_health_issues.sql');
const recoveryMigration = read('supabase/migrations/20260812230000_phase_18_backup_recovery.sql');
const correctionsMigration = read('supabase/migrations/20260813013000_phase_19_record_corrections.sql');
const businessSettingsMigration = read('supabase/migrations/20260813171610_phase_20_business_settings.sql');
const demoMigration = read('supabase/migrations/20260814183000_phase_21_fresh_start_demo_account.sql');
const multiOrganizationMigration = read('supabase/migrations/20260817200000_phase_22_multi_organization_readiness.sql');
const ownerAdministrationMigration = read('supabase/migrations/20260820152000_phase_23_owner_administration.sql');
const sharesOrganizationPermissionRepair = read('supabase/migrations/20260820172258_restore_shares_organization_execute_permission.sql');
const platformAdmin = read('platform-admin.js');
const dataPortability = read('data-portability.js');
const catalogOnboarding = read('catalog-onboarding.js');
const invitationFunction = read('supabase/functions/send-organization-invitation/index.ts');
const demoResetFunction = read('supabase/functions/reset-demo-workspace/index.ts');
const localScripts = [...index.matchAll(/<script[^>]+src=["']\.\/([^"']+)["']/g)].map(match => match[1]);
const shellAssets = [...worker.matchAll(/["']\.\/([^"']+)["']/g)].map(match => match[1]).filter(path => path !== '');

if (!index.includes(`pilot ${packageJson.version}`) || !settings.includes(`<strong>${packageJson.version}</strong>`)) {
  fail('The footer and About settings version must match package.json');
} else if (!/greenhouse-ledger-v23-owner-administration/.test(worker)) {
  fail('Phase 23 must invalidate the previous offline app shell');
} else {
  pass('Release labels are synchronized and the catalog hotfix refreshes the offline app shell');
}

if (!/create_organization_workspace/.test(auth) || !/switchOrganization/.test(auth) || !/ACTIVE_ORGANIZATION_KEY/.test(auth)) {
  fail('Phase 22 must create and switch organizations through the authenticated workspace flow');
} else if (/\.limit\(1\)/.test(auth) || !/context\.memberships\.find/.test(auth)) {
  fail('Sign-in and switching must consider every current organization membership');
} else if (!/function reset\(\)/.test(cloudLedger) || !/request!==loadRequest\|\|org!==organizationId\(\)/.test(cloudLedger)) {
  fail('Organization switching must clear prior tenant data and reject stale load results');
} else if (!/security definer/.test(multiOrganizationMigration) || !/Authentication required/.test(multiOrganizationMigration) || !/revoke insert on table public\.organizations from authenticated/.test(multiOrganizationMigration)) {
  fail('Organization creation must be atomic, authenticated, and unavailable through direct table insertion');
} else if (!/organization_created/.test(multiOrganizationMigration) || !/grant execute on function public\.create_organization_workspace/.test(multiOrganizationMigration)) {
  fail('Organization creation must be auditable and explicitly executable only by authenticated users');
} else {
  pass('Multi-organization creation, selection, stale-load protection, and tenant isolation are enforced');
}

if (!/get_platform_admin_overview/.test(platformAdmin) || !/update_organization_entitlement/.test(platformAdmin) || !/add_platform_admin_note/.test(platformAdmin)) {
  fail('Phase 23 must provide organization search, entitlement controls, and internal notes');
} else if (!/isPlatformAdmin/.test(auth) || !/list_account_organizations/.test(auth) || !/accessBlocked/.test(auth)) {
  fail('Authentication must recognize platform owners and inactive organization access');
} else if (!/create table private\.platform_administrators/.test(ownerAdministrationMigration) || !/revoke all on table private\.platform_administrators/.test(ownerAdministrationMigration)) {
  fail('Platform-owner designation must remain outside the public Data API');
} else if (!/organization_entitlements_member_select/.test(ownerAdministrationMigration) || !/private\.organization_access_allowed/.test(ownerAdministrationMigration)) {
  fail('Organization entitlements must be RLS protected and checked by membership helpers');
} else if ((ownerAdministrationMigration.match(/_enforce_entitlement before insert or update or delete/g)||[]).length !== 13) {
  fail('Every tenant operational table must enforce inactive access during writes');
} else if (!/organization_members_enforce_staff_limit/.test(ownerAdministrationMigration) || !/organization_invitations_enforce_staff_limit/.test(ownerAdministrationMigration)) {
  fail('Paid staff limits must apply to memberships and reserved invitation seats');
} else if (!/organization_entitlement_updated/.test(ownerAdministrationMigration) || !/platform_admin_note_added/.test(ownerAdministrationMigration)) {
  fail('Every platform administration action must leave immutable audit history');
} else if (/inventory_batches|plant_catalog|care_tasks/.test(ownerAdministrationMigration.match(/create or replace function public\.get_platform_admin_organization[\s\S]*?\$\$;/)?.[0]||'')) {
  fail('Platform organization detail must not expose customer inventory or operations');
} else if (!/revoke execute on function private\.shares_organization\(uuid\) from public, anon/.test(sharesOrganizationPermissionRepair) || !/grant execute on function private\.shares_organization\(uuid\) to authenticated/.test(sharesOrganizationPermissionRepair)) {
  fail('Authenticated profile RLS must retain execute access to the shared-organization helper');
} else {
  pass('Owner administration is allowlisted, entitlement-enforced, staff-limited, auditable, and inventory-isolated');
}

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
} else if (!/function toggleStarter\(id\)[\s\S]*renderContent\(\)[\s\S]*requestAnimationFrame\(openStarters\)/.test(catalogOnboarding)) {
  fail('Starter product selection must rerender the live catalog and reopen the selection panel');
} else if (/await CloudLedger\.load\(\);render\(\)/.test(catalogOnboarding) || (catalogOnboarding.match(/await CloudLedger\.load\(\);renderContent\(\)/g)||[]).length !== 4) {
  fail('Catalog mutations must refresh the visible setup screen instead of discarding generated markup');
} else if (!/\.catalog-manual-form \[name=["']common_name["']\]/.test(catalogOnboarding) || !/aria-pressed=/.test(catalogOnboarding)) {
  fail('Catalog onboarding must target the manual form precisely and expose starter selection state');
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
} else if (!/issue-report-form\{[^}]*grid-template-columns:minmax\(0,2fr\)/.test(index) || !/issue-report-form input,[^{]*\{[^}]*min-width:0/.test(index)) {
  fail('Plant-health form columns and controls must remain constrained inside their card');
} else if (!/greenhouse-ledger-v(?:17-form-containment|18-backup-recovery|19-record-corrections|20-business-settings|21-(?:fresh-start-demo|catalog-interactions)|22-multi-organization|23-owner-administration)/.test(worker) || /b\.location\?\.name\]\.filter\(Boolean\)\.join/.test(cloudLedger)) {
  fail('The Phase 17 containment repair must invalidate the old app shell and keep batch labels compact');
} else {
  pass('Plant-health observations, protected photos, and append-only follow-up history are organization-scoped');
}

if (!/Data portability &amp; recovery/.test(dataPortability) || !/Recommended retention/.test(dataPortability) || !/Recover missing records/.test(dataPortability)) {
  fail('Phase 18 must provide preview-first recovery and a visible retention policy');
} else if (!/const VERSION=2/.test(dataPortability) || !/inventory_count_lines/.test(dataPortability) || !/plant_health_issue_updates/.test(dataPortability)) {
  fail('Phase 18 backups must version and include Phase 16 and Phase 17 history');
} else if (!/member\.role='owner'/.test(recoveryMigration) || !/Backup belongs to a different organization/.test(recoveryMigration)) {
  fail('Backup recovery must be owner-only and restricted to the current organization');
} else if ((recoveryMigration.match(/on conflict do nothing/g)||[]).length !== 9 || /on conflict[\s\S]{0,40}do update/i.test(recoveryMigration)) {
  fail('Backup recovery must add missing records without overwriting live records');
} else if (!/backup_recovery_completed/.test(recoveryMigration) || !/backup_recovery_runs/.test(recoveryMigration)) {
  fail('Every completed recovery must leave an organization-scoped audit record');
} else if (!/Memberships, invitations, activity logs/.test(dataPortability) || !/does not retain downloaded backup files/.test(dataPortability)) {
  fail('Recovery exclusions and backup retention responsibility must be explicit');
} else {
  pass('Backup recovery is owner-controlled, additive, auditable, and covers current operational history');
}

if (!/Edit product/.test(catalogOnboarding) || !/Edit batch details/.test(cloudLedger) || !/Activity history is preserved for accountability/.test(cloudLedger) || !/slice\(0,activityVisible\)/.test(cloudLedger) || !/Show \$\{Math\.min\(25,remaining\)\} more/.test(cloudLedger)) {
  fail('Phase 19 must provide catalog and batch correction forms plus non-destructive activity filters');
} else if (!/revoke update on table public\.plant_catalog, public\.inventory_batches from authenticated/.test(correctionsMigration)) {
  fail('Catalog and batch corrections must not bypass the protected database functions through direct updates');
} else if ((correctionsMigration.match(/Owner or manager access required/g)||[]).length !== 3) {
  fail('Catalog, status, and batch corrections must require an owner or manager');
} else if (!/catalog_product_corrected/.test(correctionsMigration) || !/inventory_batch_corrected/.test(correctionsMigration) || !/'before'/.test(correctionsMigration) || !/'after'/.test(correctionsMigration)) {
  fail('Phase 19 corrections must preserve before-and-after activity history');
} else if (/set\s+quantity\s*=/.test(correctionsMigration) || !/Quantity is protected/.test(cloudLedger)) {
  fail('Record correction must not directly rewrite inventory quantity');
} else if (!/set_inventory_batch_photo/.test(cloudLedger) || !/Photo path must belong to this inventory batch/.test(correctionsMigration)) {
  fail('Batch photo updates must remain membership-checked after direct update access is removed');
} else {
  pass('Record corrections are manager-controlled, quantity-safe, auditable, and paired with non-destructive activity filters');
}

if (!/Email & invitations/.test(settings) || !/Business profile/.test(settings) || !/Workspace profile/.test(read('workspace-settings.js'))) {
  fail('Phase 20 must provide workspace profile, email readiness, and product information settings');
} else if (!/quantity_label/.test(read('workspace-settings.js')) || !/sku_prefix/.test(cloudLedger) || !/batch_prefix/.test(cloudLedger)) {
  fail('Phase 20 inventory labels and code-prefix preferences must reach operational forms');
} else if (!/revoke update on table public\.organizations from authenticated/.test(businessSettingsMigration)) {
  fail('Organization settings must not bypass the protected Phase 20 functions through direct updates');
} else if ((businessSettingsMigration.match(/Owner or manager access required/g)||[]).length !== 2 || !/security definer/g.test(businessSettingsMigration)) {
  fail('Phase 20 settings and branding functions must enforce owner or manager access internally');
} else if (!/organization_settings_updated/.test(businessSettingsMigration) || !/organization_branding_updated/.test(businessSettingsMigration)) {
  fail('Phase 20 business and branding changes must leave organization activity history');
} else {
  pass('Business settings are role-checked, auditable, mobile-ready, and connected to operational labels');
}

if (!/is_demo_account/.test(auth) || !/reset-demo-workspace/.test(auth) || !/Sign out and reset demo/.test(settings)) {
  fail('Phase 21 must detect the designated demo identity and reset it at sign-in and sign-out');
} else if (!/revoke all on table public\.demo_accounts from public, anon, authenticated/.test(demoMigration) || !/where demo\.profile_id = \(select auth\.uid\(\)\)/.test(demoMigration)) {
  fail('Demo designation must remain administrative and demo status must be scoped to the current account');
} else if (!/SUPABASE_SERVICE_ROLE_KEY/.test(demoResetFunction) || !/eq\("created_by",user\.id\)/.test(demoResetFunction) || !/This account is not authorized for demo reset/.test(demoResetFunction)) {
  fail('Demo reset must authenticate the caller and delete only workspaces created by the designated demo identity');
} else if (!/greenhouse-photos/.test(demoResetFunction) || !/Demo photos could not be cleared/.test(demoResetFunction)) {
  fail('Demo reset must clear tenant-scoped private photos before deleting the database workspace');
} else if (!/Invitation email is disabled in demo mode/.test(invitationFunction) || !/Create link only/.test(cloudLedger)) {
  fail('Demo mode must block external invitation email while retaining link-only lifecycle demonstrations');
} else {
  pass('Fresh-start demo mode is allowlisted, tenant-scoped, storage-aware, and safe from external email delivery');
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
