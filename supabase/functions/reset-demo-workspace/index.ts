import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.56.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

async function removeFolder(admin:ReturnType<typeof createClient>,bucket:string,path:string):Promise<void>{
  while(true){
    const {data,error}=await admin.storage.from(bucket).list(path,{limit:1000,sortBy:{column:"name",order:"asc"}});
    if(error)throw error;
    if(!data?.length)return;
    const files=data.filter(item=>item.id).map(item=>`${path}/${item.name}`);
    const folders=data.filter(item=>!item.id).map(item=>`${path}/${item.name}`);
    if(files.length){
      const {error:removeError}=await admin.storage.from(bucket).remove(files);
      if(removeError)throw removeError;
    }
    for(const folder of folders)await removeFolder(admin,bucket,folder);
  }
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const url=Deno.env.get("SUPABASE_URL");
  const publishable=Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!publishable||!serviceRole)return json({error:"Server configuration is incomplete."},503);

  const bearer=req.headers.get("Authorization")||"";
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user)return json({error:"Authentication required."},401);

  const admin=createClient(url,serviceRole,{auth:{persistSession:false}});
  const {data:demo,error:demoError}=await admin.from("demo_accounts").select("enabled").eq("profile_id",user.id).maybeSingle();
  if(demoError)return json({error:"Demo status could not be verified."},500);
  if(!demo?.enabled)return json({error:"This account is not authorized for demo reset."},403);

  const {data:organizations,error:organizationError}=await admin.from("organizations").select("id").eq("created_by",user.id);
  if(organizationError)return json({error:"Demo workspaces could not be inspected."},500);
  const organizationIds=(organizations||[]).map(item=>item.id);

  try{
    for(const organizationId of organizationIds)await removeFolder(admin,"greenhouse-photos",organizationId);
  }catch(error){
    console.error("Demo storage cleanup failed",error);
    return json({error:"Demo photos could not be cleared. The workspace was left unchanged."},500);
  }

  if(organizationIds.length){
    const {error:deleteError}=await admin.from("organizations").delete().in("id",organizationIds).eq("created_by",user.id);
    if(deleteError)return json({error:"Demo workspace could not be reset."},500);
  }

  return json({reset:true,organizations_removed:organizationIds.length});
});
