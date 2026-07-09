// supabase/functions/profile-manager/index.ts
//
// Single edge function that handles all profile-page actions:
//   - get           : fetch the caller's profile (joined with users)
//   - update        : update editable profile fields
//   - upload_avatar : store a new avatar image, update avatar_url
//   - delete_avatar : remove avatar image, clear avatar_url
//   - update_email  : change auth email (needs service role)
//
// Deploy:   supabase functions deploy profile-manager
// Secrets:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//           are provided automatically in the Supabase Edge Runtime.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { supabaseAnon, supabaseAdmin } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

const EDITABLE_FIELDS = [
  "first_name",
  "last_name",
  "bio",
  "job_title",
  "department",
  "pronouns",
  "phone",
  "timezone",
  "theme",
  "notification_preferences",
] as const

// Caller identity + row lookup happens through the RLS-scoped anon client,
// so this relies on a policy like `auth.uid() = auth_user_id` on `users`.
async function getCallerUser(supabase: ReturnType<typeof supabaseAnon>) {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, team_id")
    .eq("auth_user_id", data.user.id)
    .single()

  if (userErr || !userRow) return null
  return userRow
}

async function logActivity(
  supabase: ReturnType<typeof supabaseAnon>,
  userId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("activity_logs").insert({
    user_id: userId,
    action,
    entity_type: "profile",
    entity_id: userId,
    metadata,
    status: "success",
  })
}

serve(async (req: Request) => {
  const headers = corsHeaders(req)

  console.log("====================================")
  console.log("🚀 PROFILE-MANAGER FUNCTION HIT")
  console.log("Method:", req.method)

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabase = supabaseAnon(req)
    const { action, payload } = await req.json()

    console.log("📦 Incoming action:", action)

    const caller = await getCallerUser(supabase)
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers })
    }

    switch (action) {
      case "get": {
        const { data, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", caller.id)
          .single()
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers })
        }
        return new Response(JSON.stringify({ profile: { ...data, email: caller.email } }), { headers })
      }

      case "update": {
        const updates: Record<string, unknown> = {}
        for (const field of EDITABLE_FIELDS) {
          if (payload?.[field] !== undefined) updates[field] = payload[field]
        }
        if (Object.keys(updates).length === 0) {
          return new Response(JSON.stringify({ error: "No valid fields to update" }), { status: 400, headers })
        }
        updates.updated_at = new Date().toISOString()

        const { data, error } = await supabase
          .from("profiles")
          .update(updates)
          .eq("user_id", caller.id)
          .select()
          .single()
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers })
        }

        await logActivity(supabase, caller.id, "profile_updated", { fields: Object.keys(updates) })
        return new Response(JSON.stringify({ profile: data }), { headers })
      }

      case "upload_avatar": {
        const { fileBase64, contentType } = payload ?? {}
        if (!fileBase64 || !contentType) {
          return new Response(
            JSON.stringify({ error: "fileBase64 and contentType are required" }),
            { status: 400, headers },
          )
        }

        const ext = contentType.split("/")[1] ?? "png"
        const path = `${caller.id}/avatar.${ext}`
        const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0))

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, bytes, { contentType, upsert: true })
        if (uploadError) {
          return new Response(JSON.stringify({ error: uploadError.message }), { status: 400, headers })
        }

        const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path)
        const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`

        const { data, error } = await supabase
          .from("profiles")
          .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
          .eq("user_id", caller.id)
          .select()
          .single()
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers })
        }

        await logActivity(supabase, caller.id, "avatar_uploaded")
        return new Response(JSON.stringify({ profile: data }), { headers })
      }

      case "delete_avatar": {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("user_id", caller.id)
          .single()

        if (profileRow?.avatar_url) {
          // best-effort cleanup; ignore failures (e.g. already gone)
          const path = `${caller.id}/avatar.png`
          await supabase.storage.from("avatars").remove([path])
        }

        const { data, error } = await supabase
          .from("profiles")
          .update({ avatar_url: null, updated_at: new Date().toISOString() })
          .eq("user_id", caller.id)
          .select()
          .single()
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers })
        }

        await logActivity(supabase, caller.id, "avatar_deleted")
        return new Response(JSON.stringify({ profile: data }), { headers })
      }

      case "update_email": {
        const { newEmail } = payload ?? {}
        if (!newEmail) {
          return new Response(JSON.stringify({ error: "newEmail is required" }), { status: 400, headers })
        }

        // Requires service role — updates the auth user's email and bypasses RLS
        // for the `users` table update below.
        const admin = supabaseAdmin()

        const { data: authUser } = await supabase.auth.getUser()
        if (!authUser?.user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers })
        }

        const { error: authError } = await admin.auth.admin.updateUserById(
          authUser.user.id,
          { email: newEmail },
        )
        if (authError) {
          return new Response(JSON.stringify({ error: authError.message }), { status: 400, headers })
        }

        const { error } = await admin
          .from("users")
          .update({ email: newEmail })
          .eq("id", caller.id)
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers })
        }

        await logActivity(supabase, caller.id, "email_updated", { newEmail })
        return new Response(JSON.stringify({ success: true }), { headers })
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers })
    }
  } catch (err) {
    console.log("💥 UNHANDLED ERROR:", err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: corsHeaders(req) },
    )
  } finally {
    console.log("====================================")
    console.log("🏁 REQUEST COMPLETE")
  }
})