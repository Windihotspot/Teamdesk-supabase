import { getUser } from "../_shared/auth.ts"
import { supabaseAdmin } from "../_shared/supabaseClient.ts"
import { json } from "../_shared/response.ts"

Deno.serve(async (req) => {
  try {
    const user = await getUser(req)
    const { email, role } = await req.json()

    const admin = supabaseAdmin()

    const { data: target } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .single()

    if (!target) return json({ error: "User not found" }, 400)

    const { data: membership } = await admin
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .single()

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Forbidden" }, 403)
    }

    await admin.rpc("add_team_member", {
      p_team_id: membership.team_id,
      p_user_id: target.id,
      p_role: role,
    })

    return json({ message: "Member invited" })
  } catch (err) {
    return json({ error: err.message }, 400)
  }
})