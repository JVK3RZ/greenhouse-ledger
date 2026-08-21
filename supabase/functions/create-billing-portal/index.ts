import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.56.0";
import Stripe from "npm:stripe@22.0.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),publishable=Deno.env.get("SUPABASE_ANON_KEY"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),stripeKey=Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl=Deno.env.get("GREENHOUSE_LEDGER_SITE_URL")||"https://jvk3rz.github.io/greenhouse-ledger/";
  if(!url||!publishable||!serviceRole||!stripeKey)return json({error:"Billing is not configured yet."},503);
  const bearer=req.headers.get("Authorization")||"";
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:bearer}}});
  const {data:{user}}=await userClient.auth.getUser();
  if(!user)return json({error:"Authentication required."},401);
  const {organization_id}=await req.json().catch(()=>({}));
  const admin=createClient(url,serviceRole,{auth:{persistSession:false}});
  const [{data:member},{data:context}]=await Promise.all([
    admin.from("organization_members").select("role,status").eq("organization_id",organization_id).eq("profile_id",user.id).maybeSingle(),
    admin.rpc("get_stripe_billing_context",{target_organization_id:organization_id})
  ]);
  if(!member||member.role!=="owner"||member.status!=="active")return json({error:"Active owner access required."},403);
  if(!context?.customer_id)return json({error:"No Stripe billing account exists for this organization yet."},404);
  const stripe=new Stripe(stripeKey);
  const session=await stripe.billingPortal.sessions.create({customer:context.customer_id,return_url:siteUrl});
  return json({url:session.url});
});
