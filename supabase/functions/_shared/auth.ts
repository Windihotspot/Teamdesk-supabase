import { supabaseAnon } from "./supabaseClient.ts"

export async function getUser(req: Request) {
  const client = supabaseAnon(req)

  const { data, error } = await client.auth.getUser()

  if (error || !data.user) {
    throw new Error("Unauthorized")
  }

  return data.user
}