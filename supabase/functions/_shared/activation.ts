import { createClient } from "jsr:@supabase/supabase-js@2.56.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export async function activationHandler(req:Request,kind:'owner'|'staff'){
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_ANON_KEY');
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resend=Deno.env.get('RESEND_API_KEY');
  const from=Deno.env.get('INVITATION_FROM_EMAIL');
  const site=Deno.env.get('GREENHOUSE_LEDGER_SITE_URL')||'https://jvk3rz.github.io/greenhouse-ledger/';
  if(!url||!key||!secret||!resend||!from)return json({error:'Activation email is not configured. Contact the platform administrator.'},503);
  const caller=createClient(url,key,{global:{headers:{Authorization:req.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await caller.auth.getUser();
  if(authError||!user)return json({error:'Authentication required'},401);
  const body=await req.json().catch(()=>({}));
  const id=kind==='owner'?body.request_id:body.invitation_id;
  if(typeof id!=='string'||! /^[0-9a-f-]{36}$/i.test(id))return json({error:'Valid invitation ID required'},400);
  // SQL checks the platform allowlist or active team role, including manager-to-worker limits.
  const {data:activation,error}=await caller.rpc('prepare_account_activation',{activation_kind:kind,target_id:id});
  if(error)return json({error:error.message},403);
  const admin=createClient(url,secret,{auth:{persistSession:false}});
  const record=async(delivered:boolean)=>await admin.rpc('record_activation_delivery',{
    activation_kind:kind,target_id:id,activation_code:activation.code,delivered
  });
  try{
    const redirect=new URL(site);
    redirect.search='';redirect.hash='';
    redirect.searchParams.set(kind==='owner'?'owner_invite':'invite',activation.code);
    redirect.searchParams.set('activate','1');
    const {data:link,error:linkError}=await admin.auth.admin.generateLink({
      type:activation.existing_user?'magiclink':'invite',email:activation.email,options:{redirectTo:redirect.toString()}
    });
    if(linkError||!link?.properties?.action_link)throw new Error('Could not generate activation');
    // Auth tokens are sent only to the named email, never returned to the inviting administrator.
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[activation.email],subject:`Activate your Greenhouse Ledger ${kind==='owner'?'owner account':'team invitation'}`,
        html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>${esc(activation.business)}</h1><p>${kind==='owner'?'Your owner request has been approved.':'You have been invited to join this greenhouse.'}</p><p><a href="${esc(link.properties.action_link)}">Continue account setup</a></p><p>This private, single-use sign-in link is for ${esc(activation.email)}. Open it to finish setup; no separate verification email is required. If it expires, ask for a new invitation email.</p></div>`})
    });
    if(!response.ok)throw new Error('Email provider rejected delivery');
    const receipt=await record(true);
    if(receipt.error)return json({sent:true,warning:'Email sent, but delivery tracking could not be updated.'});
    return json({sent:true});
  }catch{
    await record(false);
    return json({error:'Activation email could not be delivered. The invitation is saved; try resending it.'},502);
  }
}
