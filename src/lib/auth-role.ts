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
  const [profileLookup, ownerLookup, memberLookup, memberByAuthLookup] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("gym_profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("members").select("id").eq("id", user.id).maybeSingle(),
    supabase.from("members").select("id").eq("auth_user_id", user.id).maybeSingle(),
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

  if (memberLookup.data || memberByAuthLookup.data) {
    return "member";
  }

  return null;
};
