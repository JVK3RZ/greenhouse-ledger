// Node 24+: exercise the Edge handler without sending email or provisioning users.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/_shared/activation.ts',import.meta.url),'utf8')).replace(/^import .*;\n/m,'').replace('export async function','async function');
async function run({auth=true,allowed=true,delivered=true,existing=false,configured=true}={}){
  const calls=[];let email;
  const caller={auth:{getUser:async()=>({data:{user:auth?{id:'actor'}:null}})},rpc:async()=>allowed?{data:{email:'recipient@example.invalid',business:'<script>bad</script>',code:'code',existing_user:existing}}:{error:{message:'Access denied'}}};
  const admin={auth:{admin:{generateLink:async payload=>{calls.push(['generate',payload]);return {data:{properties:{action_link:'https://auth.invalid/?token=secret&kind=invite'}}};}}},rpc:async(name,payload)=>{calls.push([name,payload]);return {};}};
  const context=vm.createContext({Request,Response,URL,fetch:async(url,options)=>{email=JSON.parse(options.body);return {ok:delivered};},Deno:{env:{get:key=>!configured&&key==='RESEND_API_KEY'?undefined:key==='GREENHOUSE_LEDGER_SITE_URL'?'https://app.invalid/':key}},createClient:(url,key)=>key==='SUPABASE_SERVICE_ROLE_KEY'?admin:caller});
  vm.runInContext(source,context);
  const response=await context.activationHandler(new Request('https://fn.invalid',{method:'POST',body:JSON.stringify({request_id:'11111111-1111-1111-1111-111111111111'})}),'owner');
  return {status:response.status,body:await response.json(),calls,email};
}
for(const options of [{auth:false},{allowed:false},{configured:false}]){const r=await run(options);assert(r.status>=400);assert.equal(r.calls.length,0);}
let r=await run();assert.equal(r.status,200);assert.deepEqual(r.body,{sent:true});assert.equal(r.calls[0][1].type,'invite');assert.deepEqual(r.email.to,['recipient@example.invalid']);assert(r.email.html.includes('&lt;script&gt;'));assert(!JSON.stringify(r.body).includes('secret'));assert.equal(r.calls[1][1].delivered,true);
r=await run({existing:true});assert.equal(r.calls[0][1].type,'magiclink');
r=await run({delivered:false});assert.equal(r.status,502);assert.equal(r.calls[1][1].delivered,false);
console.log('Activation delivery checks passed: authentication, authorization, configuration, recipient binding, escaped email, token secrecy, existing accounts, delivery failure.');
