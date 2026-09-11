-- Run after the Phase 27 migration inside BEGIN / ROLLBACK. No email is sent.
do $$
declare actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid();
  request_id uuid; org uuid; code uuid; old_code uuid; staff_invite uuid; payload jsonb; denied boolean;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (actor,'phase27-owner@example.invalid',now(),'{}'),
    (outsider,'phase27-other@example.invalid',now(),'{}'),
    (staff,'phase27-worker@example.invalid',null,'{}'),
    (manager,'phase27-manager@example.invalid',now(),'{}');
  update public.profiles set username='p27_'||replace(id::text,'-','')::varchar(20) where id in(actor,outsider,staff,manager);
  insert into private.platform_administrators(profile_id) values(actor);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform public.request_owner_account('phase27-owner@example.invalid','Test Owner','Test Greenhouse');
  perform public.request_owner_account('PHASE27-OWNER@example.invalid','Test Owner','Duplicate');
  if (select count(*) from private.owner_account_requests where email='phase27-owner@example.invalid')<>1 then raise exception 'Duplicate request was created'; end if;
  select id into request_id from private.owner_account_requests where email='phase27-owner@example.invalid';
  payload:=public.prepare_account_activation('owner',request_id);old_code:=(payload->>'code')::uuid;
  update private.owner_account_requests set delivery_attempt_at=now()-interval '2 minutes' where id=request_id;
  payload:=public.prepare_account_activation('owner',request_id);code:=(payload->>'code')::uuid;
  if code=old_code then raise exception 'Resend failed to rotate code'; end if;
  denied:=false;begin perform public.accept_owner_activation(old_code);exception when others then denied:=true;end;
  if not denied then raise exception 'Old owner code accepted'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  denied:=false;begin perform public.list_owner_account_requests();exception when others then denied:=true;end;
  if not denied then raise exception 'Non-admin read private requests'; end if;
  denied:=false;begin perform public.prepare_account_activation('owner',request_id);exception when others then denied:=true;end;
  if not denied then raise exception 'Non-admin approved request'; end if;
  denied:=false;begin perform public.create_organization_workspace('Unauthorized');exception when others then denied:=true;end;
  if not denied then raise exception 'Unapproved workspace created'; end if;
  denied:=false;begin perform public.accept_owner_activation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Wrong email accepted owner invite'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  update private.owner_account_requests set expires_at=now()-interval '1 minute' where id=request_id;
  denied:=false;begin perform public.accept_owner_activation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Expired owner token accepted'; end if;
  update private.owner_account_requests set expires_at=now()+interval '1 day' where id=request_id;
  perform public.review_owner_account_request(request_id,'revoked');
  denied:=false;begin perform public.accept_owner_activation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Revoked owner token accepted'; end if;
  update private.owner_account_requests set status='pending',delivery_attempt_at=null where id=request_id;
  payload:=public.prepare_account_activation('owner',request_id);code:=(payload->>'code')::uuid;
  org:=public.accept_owner_activation(code);
  if not exists(select 1 from public.organization_members where organization_id=org and profile_id=actor and role='owner') then raise exception 'Owner membership missing'; end if;
  denied:=false;begin perform public.accept_owner_activation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Owner token reused'; end if;
  insert into public.organization_invitations(organization_id,email,role) values(org,'phase27-worker@example.invalid','worker') returning id,organization_invitations.code into staff_invite,code;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
  denied:=false;begin perform public.accept_organization_invitation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Unconfirmed email accepted staff invitation'; end if;
  update auth.users set email_confirmed_at=now() where id=staff;
  perform public.accept_organization_invitation(code);
  if not exists(select 1 from public.organization_members where organization_id=org and profile_id=staff and role='worker') then raise exception 'Worker membership missing'; end if;
  denied:=false;begin perform public.accept_organization_invitation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Staff token reused'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.organization_members(organization_id,profile_id,role) values(org,manager,'manager');
  insert into public.organization_invitations(organization_id,email,role) values(org,'phase27-new-manager@example.invalid','manager') returning id into staff_invite;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);
  denied:=false;begin perform public.prepare_account_activation('staff',staff_invite);exception when others then denied:=true;end;
  if not denied then raise exception 'Manager emailed manager invitation'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.organization_invitations(organization_id,email,role) values(org,'phase27-other@example.invalid','worker') returning id,organization_invitations.code into staff_invite,code;
  update public.organization_entitlements set staff_limit=3 where organization_id=org;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  denied:=false;begin perform public.accept_organization_invitation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Staff limit bypassed'; end if;
  update public.organization_entitlements set staff_limit=10,access_status='suspended' where organization_id=org;
  denied:=false;begin perform public.accept_organization_invitation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Suspended workspace joined'; end if;
  update public.organization_entitlements set access_status='active' where organization_id=org;
  update public.organization_invitations set revoked_at=now() where id=staff_invite;
  denied:=false;begin perform public.accept_organization_invitation(code);exception when others then denied:=true;end;
  if not denied then raise exception 'Revoked staff invite accepted'; end if;
  if has_function_privilege('anon','public.prepare_account_activation(text,uuid)','execute') then raise exception 'Anon activation dispatch privilege'; end if;
  if has_function_privilege('authenticated','public.record_activation_delivery(text,uuid,uuid,boolean)','execute') then raise exception 'Client delivery forgery privilege'; end if;
  if has_table_privilege('authenticated','private.owner_account_requests','select') then raise exception 'Private requests exposed'; end if;
end; $$;
select 'Phase 27 authorization, duplicate requests, owner activation, resend rotation, staff activation and role boundaries passed' as result;
