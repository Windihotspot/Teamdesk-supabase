import { corsHeaders } from "./cors.ts"

export const log = (label: string, data?: any) => {
  console.log(`\n===== ${label} =====`)
  if (data) console.log(JSON.stringify(data, null, 2))
}

export const ok = (req: Request, data: any, status = 200) => {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  })
}

export const fail = (req: Request, message: string, status = 400, extra?: any) => {
  return new Response(
    JSON.stringify({
      success: false,
      error: message,
      ...extra,
    }),
    {
      status,
      headers: {
        ...corsHeaders(req),
        "Content-Type": "application/json",
      },
    }
  )
}

// 🔥 SAFE JSON PARSER (prevents OPTIONS crash issues)
export const safeJson = async (req: Request) => {
  try {
    return await req.json()
  } catch {
    return null
  }
}