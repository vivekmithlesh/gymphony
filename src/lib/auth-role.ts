import { supabase } from "@/supabase";

export type UserRole = "member" | "owner";

const normalizeRole = (value: unknown): UserRole | null => {
  if (value === "member" || value === "owner") {
    return value;
  }

  return null;
};

export const getDashboardPathForRole = (role: UserRole) => {
  return role === "member" ? "/member-dashboard" : "/dashboard";
};

export const resolveUserRole = async (
  user: {
    id: string;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  },
): Promise<UserRole | null> => {
  // Identity is members.id = profiles.id = auth.uid() (the `members` view has no
  // auth_user_id column — querying it 400s on every resolve). Look the member up
  // by id only.
  const [profileLookup, ownerLookup, memberLookup] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("gym_profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("members").select("id").eq("id", user.id).maybeSingle(),
  ]);

  const profileRole = normalizeRole(profileLookup.data?.role);
  if (profileRole) {
    return profileRole;
  }

  const ownerRole = normalizeRole(ownerLookup.data?.role);
  if (ownerRole) {
    return ownerRole;
  }

  if (ownerLookup.data) {
    return "owner";
  }

  if (memberLookup.data) {
    return "member";
  }

  // Reliable fallback: the role stamped into the auth user's metadata at signUp
  // ({ data: { role: "owner" } }). This works even when the profile row isn't
  // readable yet (RLS / replication lag right after signup), so a freshly
  // signed-in user always resolves to a role and the redirect never stalls.
  const metaRole = normalizeRole(
    user.user_metadata?.role ?? user.app_metadata?.role,
  );
  if (metaRole) {
    return metaRole;
  }

  return null;
};
