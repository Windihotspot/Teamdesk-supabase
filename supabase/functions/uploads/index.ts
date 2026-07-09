// supabase/functions/uploads/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { supabaseAnon } from "../_shared/supabaseClient.ts"
import { corsHeaders } from "../_shared/cors.ts"

const BUCKETS = {
  user_avatar: "avatars",
  project_avatar: "avatars",
  project_file: "project-files",
  task_file: "task-files",
}

serve(async (req: Request) => {
  const headers = corsHeaders(req)

  console.log("====================================")
  console.log("🚀 UPLOADS FUNCTION HIT")

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers })
  }

  try {
    const supabase = supabaseAnon(req)
    const body = await req.json()
    const { action } = body

    console.log("⚙️ Action:", action)

    // ================= GET UPLOAD URL =================
    // Client calls this first, then uploads directly to Supabase Storage
    if (action === "get_upload_url") {
      const { upload_type, file_name, file_size, content_type, entity_id } = body
      // upload_type: "user_avatar" | "project_avatar" | "project_file" | "task_file"
      // entity_id: user_id, project_id, or task_id depending on type

      if (!upload_type || !file_name || !content_type || !entity_id) {
        return new Response(
          JSON.stringify({ error: "upload_type, file_name, content_type, entity_id required" }),
          { status: 400, headers }
        )
      }

      const bucket = BUCKETS[upload_type as keyof typeof BUCKETS]
      if (!bucket) {
        return new Response(JSON.stringify({ error: "Invalid upload_type" }), { status: 400, headers })
      }

      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user

      // Build the storage path
      const sanitizedName = file_name.replace(/[^a-zA-Z0-9.\-_]/g, "_")
      const timestamp = Date.now()
      let path: string

      if (upload_type === "user_avatar") {
        path = `users/${entity_id}/${timestamp}_${sanitizedName}`
      } else if (upload_type === "project_avatar") {
        path = `projects/${entity_id}/${timestamp}_${sanitizedName}`
      } else if (upload_type === "project_file") {
        path = `${entity_id}/${user?.id}/${timestamp}_${sanitizedName}`
      } else {
        // task_file
        path = `${entity_id}/${user?.id}/${timestamp}_${sanitizedName}`
      }

      // Create a signed upload URL (valid for 60 seconds)
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(path)

      if (error) throw error

      console.log("✅ Signed upload URL created for:", path)

      return new Response(
        JSON.stringify({
          data: {
            signed_url: data.signedUrl,
            token: data.token,
            path,
            bucket,
          },
        }),
        { headers }
      )
    }

    // ================= CONFIRM UPLOAD =================
    // Called after the client successfully uploads the file
    // Saves the record to attachments table (for task/project files)
    // or updates avatar_url on users/projects table
    if (action === "confirm") {
      const { upload_type, path, bucket, entity_id, file_name, file_size } = body

      if (!upload_type || !path || !bucket || !entity_id) {
        return new Response(
          JSON.stringify({ error: "upload_type, path, bucket, entity_id required" }),
          { status: 400, headers }
        )
      }

      const { data: userRes } = await supabase.auth.getUser()
      const user = userRes?.user

      // Build the public or signed URL
      let file_url: string

      if (bucket === "avatars") {
        // Public bucket — get public URL
        const { data } = supabase.storage.from(bucket).getPublicUrl(path)
        file_url = data.publicUrl
      } else {
        // Private bucket — store the path; generate signed URLs on demand
        file_url = path
      }

      // Handle each type
      if (upload_type === "user_avatar") {
        // Update profiles table
        const { error } = await supabase
          .from("profiles")
          .update({ avatar_url: file_url })
          .eq("user_id", entity_id)

        if (error) throw error

        // Also update users table
        await supabase
          .from("users")
          .update({ avatar_url: file_url })
          .eq("id", entity_id)

        console.log("✅ User avatar updated:", entity_id)
        return new Response(JSON.stringify({ data: { avatar_url: file_url } }), { headers })
      }

      if (upload_type === "project_avatar") {
        // You can add an avatar_url column to projects table, or store as metadata
        // For now we return the URL for the frontend to handle
        console.log("✅ Project avatar confirmed:", entity_id)
        return new Response(JSON.stringify({ data: { avatar_url: file_url } }), { headers })
      }

      if (upload_type === "project_file" || upload_type === "task_file") {
        // Insert into attachments table
        const attachmentData: Record<string, unknown> = {
          file_url,
          file_name,
          file_size,
          uploaded_by: user?.id,
        }

        if (upload_type === "task_file") {
          attachmentData.task_id = entity_id
        }
        // Note: attachments table doesn't have project_id column per your schema
        // If you want project-level files, consider adding project_id to attachments
        // or use a separate project_attachments table

        const { data, error } = await supabase
          .from("attachments")
          .insert(attachmentData)
          .select()
          .single()

        if (error) throw error

        console.log("✅ Attachment record saved:", data.id)
        return new Response(JSON.stringify({ data }), { headers })
      }

      return new Response(JSON.stringify({ error: "Unhandled upload_type" }), { status: 400, headers })
    }

    // ================= GET SIGNED READ URL =================
    // For private buckets — generate a temporary read URL
    if (action === "get_read_url") {
      const { bucket, path, expires_in } = body
      // expires_in: seconds, default 3600 (1 hour)

      if (!bucket || !path) {
        return new Response(JSON.stringify({ error: "bucket and path required" }), { status: 400, headers })
      }

      if (!["project-files", "task-files"].includes(bucket)) {
        return new Response(JSON.stringify({ error: "Only private buckets need signed read URLs" }), { status: 400, headers })
      }

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expires_in ?? 3600)

      if (error) throw error

      console.log("✅ Signed read URL created")
      return new Response(JSON.stringify({ data: { signed_url: data.signedUrl } }), { headers })
    }

    // ================= DELETE =================
    if (action === "delete") {
      const { bucket, path, attachment_id } = body

      if (!bucket || !path) {
        return new Response(JSON.stringify({ error: "bucket and path required" }), { status: 400, headers })
      }

      // Remove from storage
      const { error: storageError } = await supabase.storage
        .from(bucket)
        .remove([path])

      if (storageError) throw storageError

      // Remove attachment record if provided
      if (attachment_id) {
        const { error: dbError } = await supabase
          .from("attachments")
          .delete()
          .eq("id", attachment_id)

        if (dbError) console.log("⚠️ Attachment record delete error:", dbError.message)
      }

      console.log("✅ File deleted:", path)
      return new Response(JSON.stringify({ message: "File deleted" }), { headers })
    }

    // ================= LIST FILES =================
    if (action === "list") {
      const { bucket, folder } = body

      if (!bucket || !folder) {
        return new Response(JSON.stringify({ error: "bucket and folder required" }), { status: 400, headers })
      }

      const { data, error } = await supabase.storage
        .from(bucket)
        .list(folder, { sortBy: { column: "created_at", order: "desc" } })

      if (error) throw error

      console.log("✅ Files listed:", data?.length)
      return new Response(JSON.stringify({ data }), { headers })
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers })

  } catch (err) {
    console.log("💥 UNHANDLED ERROR:", err.message)
    return new Response(
      JSON.stringify({ error: err.message || "Unexpected error" }),
      { status: 500, headers }
    )
  } finally {
    console.log("====================================")
    console.log("🏁 REQUEST COMPLETE")
  }
})