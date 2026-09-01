// Run with Playwright installed (or CODEX_PRIMARY_RUNTIME_NODE_MODULES set).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/package.json`:import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const styles=html.match(/<style>[\s\S]*?<\/style>/)?.[0]||'';
await page.route('https://test.invalid/**',route=>route.fulfill({body:`${styles}<div id="app"></div>`,contentType:'text/html'}));
async function setup(query='',session=false,wrongEmail=false,existing=false){
  await page.goto(`https://test.invalid/${query}`);
  await page.evaluate(({session,wrongEmail,existing})=>{
    window.calls=[];window.ready=null;let profileUsername=existing?'existing':null;
    const user={id:'test',email:wrongEmail?'wrong@example.invalid':'owner@example.invalid',email_confirmed_at:'2026-09-01'};
    window.GREENHOUSE_SUPABASE={url:'https://mock.invalid',publishableKey:'test'};
    window.supabase={createClient:()=>({
      auth:{getSession:async()=>({data:{session:session?{user}:null}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>{},signOut:async()=>{},updateUser:async()=>({}),
        signInWithPassword:async()=>({data:{session:{user}}})},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:{username:profileUsername}})})}),update:values=>({eq:async()=>{profileUsername=values.username;return {};}})}),
      rpc:async(name,payload)=>{
        window.calls.push({name,payload});
        if(name==='get_owner_activation')return {data:{business_name:'Example Greenhouse',email:'owner@example.invalid'}};
        if(name==='get_organization_invitation_details')return {data:[{organization_name:'Example Greenhouse',email:'owner@example.invalid',role:'worker'}]};
        if(name==='list_account_organizations')return {data:[{organization:{id:'org'},entitlement:{access_status:'active'},status:'active',role:'owner'}]};
        return {data:name.startsWith('accept_')?'org':false};
      }
    })};
  },{session,wrongEmail,existing});
  await page.addScriptTag({content:auth});
  await page.evaluate(()=>LedgerAuth.initialize({onReady:c=>{window.ready=c;}}));
}
await setup();
await page.getByRole('button',{name:'Request owner account',exact:true}).click();
await page.getByLabel('Your name').fill('Example Owner');await page.getByLabel('Business name').fill('Example Greenhouse');await page.getByLabel('Email',{exact:true}).fill('owner@example.invalid');
await page.getByRole('button',{name:'Submit request'}).click();
assert.match(await page.locator('#app').innerText(),/request has been received/);
assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='request_owner_account').length),1);
await setup('?owner_invite=abc&activate=1',true);
await page.getByLabel('Display name').fill('Example Owner');await page.getByLabel('Username').fill('example_owner');await page.getByLabel('Password',{exact:true}).fill('test-password-only');
await page.getByRole('button',{name:'Activate owner workspace'}).click();
await page.waitForFunction(()=>window.ready!==null);
assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='accept_owner_activation').length),1);
assert.equal(new URL(page.url()).search,'');
await setup('?invite=abc&activate=1',true,false,true);
assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);
await page.getByRole('button',{name:'Join greenhouse'}).click();await page.waitForFunction(()=>window.ready!==null);
assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='accept_organization_invitation').length),1);
await setup('?owner_invite=abc&activate=1',true,true);
assert.match(await page.locator('#app').innerText(),/invited email address/);
assert.equal(await page.evaluate(()=>calls.filter(c=>c.name.startsWith('accept_')).length),0);
await setup();await page.getByRole('button',{name:'Request owner account',exact:true}).click();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
if(process.env.ONBOARDING_SCREENSHOT)await page.screenshot({path:process.env.ONBOARDING_SCREENSHOT});
assert.deepEqual(errors,[]);
await browser.close();
console.log('Browser checks passed: request submission, owner setup, existing staff acceptance, wrong-email rejection, mobile layout, no page errors.');
