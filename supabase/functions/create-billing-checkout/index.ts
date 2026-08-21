import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.56.0";
import Stripe from "npm:stripe@22.0.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const plans={
  pilot:{price:Deno.env.get("STRIPE_PILOT_PRICE_ID"),staff:5},
  starter:{price:Deno.env.get("STRIPE_STARTER_PRICE_ID"),staff:10},
  growth:{price:Deno.env.get("STRIPE_GROWTH_PRICE_ID"),staff:25}
} as const;

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
  const {organization_id,plan}=await req.json().catch(()=>({}));
  if(!organization_id||!(plan in plans))return json({error:"Choose a supported billing plan."},400);
  const selected=plans[plan as keyof typeof plans];
  if(!selected.price)return json({error:"That plan is not configured for checkout yet."},503);
  const admin=createClient(url,serviceRole,{auth:{persistSession:false}});
  const [{data:member},{data:demo},{data:context}]=await Promise.all([
    admin.from("organization_members").select("role,status").eq("organization_id",organization_id).eq("profile_id",user.id).maybeSingle(),
    admin.from("demo_accounts").select("enabled").eq("profile_id",user.id).maybeSingle(),
    admin.rpc("get_stripe_billing_context",{target_organization_id:organization_id})
  ]);
  if(!member||member.role!=="owner"||member.status!=="active")return json({error:"Active owner access required."},403);
  if(demo?.enabled)return json({error:"Billing is disabled in demo mode."},403);
  if(context?.subscription_id&&!["canceled","incomplete_expired"].includes(context.subscription_status))return json({error:"This organization already has a subscription. Open billing management instead."},409);
  const stripe=new Stripe(stripeKey);
  let customer=context?.customer_id as string|undefined;
  if(!customer){
    const created=await stripe.customers.create({email:user.email,metadata:{organization_id},name:context?.organization_name||undefined});
    customer=created.id;
    const {error}=await admin.rpc("set_organization_stripe_customer",{target_organization_id:organization_id,customer_id:customer});
    if(error)return json({error:"Could not prepare the billing account."},500);
  }
  const success=new URL(siteUrl);success.searchParams.set("billing","success");
  const cancel=new URL(siteUrl);cancel.searchParams.set("billing","canceled");
  const session=await stripe.checkout.sessions.create({mode:"subscription",customer,line_items:[{price:selected.price,quantity:1}],
    success_url:success.toString(),cancel_url:cancel.toString(),client_reference_id:organization_id,
    metadata:{organization_id,plan,staff_limit:String(selected.staff)},subscription_data:{metadata:{organization_id,plan,staff_limit:String(selected.staff)}}});
  return json({url:session.url});
});
