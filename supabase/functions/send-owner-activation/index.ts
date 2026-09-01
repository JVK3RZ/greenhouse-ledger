import "jsr:@supabase/functions-js@2.5.0/edge-runtime.d.ts";
import { activationHandler } from "../_shared/activation.ts";
Deno.serve(req=>activationHandler(req,'owner'));
