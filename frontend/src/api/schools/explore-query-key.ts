/**
 * Explore responses include server-computed saved-Profile fit. Keep their
 * root in a leaf module so authentication cleanup can share it without
 * making the Explore transport and auth hooks depend on each other.
 */
export const schoolsExploreQueryKey = ["schools", "explore"] as const;
