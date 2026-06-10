// Shared CORS headers for browser
// Tighten `Access-Control-Allow-Origin` for production later
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE"
};