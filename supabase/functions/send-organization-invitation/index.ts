import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.56.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL");
  const publishable=Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey=Deno.env.get("RESEND_API_KEY");
  const from=Deno.env.get("INVITATION_FROM_EMAIL");
  const siteUrl=Deno.env.get("GREENHOUSE_LEDGER_SITE_URL")||"https://jvk3rz.github.io/greenhouse-ledger/";
  if(!url||!publishable||!serviceRole)return json({error:"Server configuration is incomplete."},503);
  if(!resendKey||!from)return json({error:"Email delivery is not configured yet. Copy the invitation link instead."},503);

  const bearer=req.headers.get("Authorization")||"";
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user)return json({error:"Authentication required."},401);

  const {invitation_id}=await req.json().catch(()=>({}));
  if(!invitation_id)return json({error:"Invitation is required."},400);
  const admin=createClient(url,serviceRole,{auth:{persistSession:false}});
  const {data:demoAccount}=await admin.from("demo_accounts").select("enabled").eq("profile_id",user.id).maybeSingle();
  if(demoAccount?.enabled)return json({error:"Invitation email is disabled in demo mode. Copy the private link instead."},403);
  const {data:invitation,error:inviteError}=await admin.from("organization_invitations")
    .select("id,organization_id,email,role,code,expires_at,accepted_at,revoked_at,organization:organizations(name)")
    .eq("id",invitation_id).single();
  if(inviteError||!invitation)return json({error:"Invitation not found."},404);
  const {data:membership}=await admin.from("organization_members").select("role")
    .eq("organization_id",invitation.organization_id).eq("profile_id",user.id).maybeSingle();
  if(!membership||!["owner","manager"].includes(membership.role))return json({error:"Owner or manager access required."},403);
  if(invitation.accepted_at||invitation.revoked_at||new Date(invitation.expires_at)<=new Date())return json({error:"Only active invitations can be emailed."},409);

  const inviteUrl=new URL(siteUrl); inviteUrl.searchParams.set("invite",invitation.code);
  const business=(invitation.organization as {name:string}|null)?.name||"a greenhouse team";
  const emailResponse=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[invitation.email],subject:`You’re invited to join ${business} in Greenhouse Ledger`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2b24"><h1>Join ${business}</h1><p>You’ve been invited as <strong>${invitation.role}</strong>.</p><p><a href="${inviteUrl.toString()}" style="display:inline-block;padding:12px 18px;background:#315f49;color:white;text-decoration:none;border-radius:8px">Review invitation</a></p><p>This single-use invitation is reserved for ${invitation.email} and expires ${new Date(invitation.expires_at).toUTCString()}.</p><p>If you weren’t expecting this invitation, you can ignore this email.</p></div>`})});
  if(!emailResponse.ok){const detail=await emailResponse.text();await admin.from("organization_invitations").update({delivery_status:"failed",delivery_error:detail.slice(0,300)}).eq("id",invitation.id);return json({error:"The invitation was created, but the email could not be delivered."},502);}
  await admin.from("organization_invitations").update({sent_at:new Date().toISOString(),delivery_status:"sent",delivery_error:null}).eq("id",invitation.id);
  return json({sent:true});
});
