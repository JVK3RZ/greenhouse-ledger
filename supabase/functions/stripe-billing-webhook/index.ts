import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.56.0";
import Stripe from "npm:stripe@22.0.0";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const unix=(value:number|null|undefined)=>value?new Date(value*1000).toISOString():null;

Deno.serve(async req=>{
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const stripeKey=Deno.env.get("STRIPE_SECRET_KEY"),webhookSecret=Deno.env.get("STRIPE_WEBHOOK_SECRET"),url=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!stripeKey||!webhookSecret||!url||!serviceRole)return json({error:"Webhook configuration is incomplete."},503);
  const signature=req.headers.get("stripe-signature");
  if(!signature)return json({error:"Stripe signature required."},400);
  const stripe=new Stripe(stripeKey);
  let event:Stripe.Event;
  try{event=await stripe.webhooks.constructEventAsync(await req.text(),signature,webhookSecret,undefined,Stripe.createSubtleCryptoProvider());}
  catch{return json({error:"Invalid Stripe signature."},400);}
  if(!["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type))return json({received:true,ignored:true});

  const subscription=event.data.object as Stripe.Subscription;
  const customerId=typeof subscription.customer==="string"?subscription.customer:subscription.customer.id;
  const item=subscription.items.data[0];
  const priceId=item?.price?.id||"";
  const configured={
    [Deno.env.get("STRIPE_PILOT_PRICE_ID")||"__pilot"]:{plan:"pilot",staff:5},
    [Deno.env.get("STRIPE_STARTER_PRICE_ID")||"__starter"]:{plan:"starter",staff:10},
    [Deno.env.get("STRIPE_GROWTH_PRICE_ID")||"__growth"]:{plan:"growth",staff:25}
  } as Record<string,{plan:string;staff:number}>;
  const plan=configured[priceId];
  if(!plan)return json({error:"Stripe price is not mapped to a Greenhouse Ledger plan."},422);
  const admin=createClient(url,serviceRole,{auth:{persistSession:false}});
  let organizationId=subscription.metadata?.organization_id||null;
  if(!organizationId){const resolved=await admin.rpc("resolve_stripe_billing_organization",{customer_id:customerId,subscription_id:subscription.id});organizationId=resolved.data;}
  if(!organizationId)return json({error:"Subscription is not linked to an organization."},422);
  const periodEnd=(item as unknown as {current_period_end?:number})?.current_period_end||(subscription as unknown as {current_period_end?:number})?.current_period_end;
  const status=subscription.status;
  const access=status==="active"?"active":status==="trialing"?"trialing":status==="past_due"?"grace_period":status==="canceled"?"canceled":"suspended";
  const {data,error}=await admin.rpc("apply_stripe_subscription_event",{
    stripe_event_id:event.id,event_type:event.type,event_created:unix(event.created),target_organization_id:organizationId,
    customer_id:customerId,subscription_id:subscription.id,price_id:priceId,target_plan:plan.plan,
    target_subscription_status:status,target_access_status:access,target_staff_limit:plan.staff,
    target_trial_end:unix(subscription.trial_end),target_period_end:unix(periodEnd),target_cancel_at_period_end:subscription.cancel_at_period_end
  });
  if(error)return json({error:"Could not synchronize subscription state."},500);
  return json({received:true,applied:data===true});
});
