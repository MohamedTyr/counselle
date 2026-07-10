import { jsonRequestInit, requestJson } from "@/api/http/client"
import type { Profile, ProfilePatch } from "@/api/workspace/types"

export function getProfile() {
  return requestJson<Profile>("/profile")
}

export function updateProfile(patch: ProfilePatch) {
  return requestJson<Profile>("/profile", jsonRequestInit("PATCH", patch))
}
