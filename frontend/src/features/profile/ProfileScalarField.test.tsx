import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { ProfileScalarField } from "@/features/profile/ProfileScalarField"
import type { MultiSelectFieldConfig } from "@/features/profile/profile-field-types"

const SIZES_CONFIG: MultiSelectFieldConfig = {
  kind: "multi-select",
  key: "sizes",
  label: "Sizes",
  options: [
    { label: "Small", value: "small" },
    { label: "Medium", value: "medium" },
    { label: "Large", value: "large" },
  ],
}

describe("ProfileScalarField — multi-select", () => {
  test("selecting an option commits the backend literal, not the display label", () => {
    const onCommit = vi.fn()
    render(
      <ProfileScalarField config={SIZES_CONFIG} onCommit={onCommit} value={null} />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Small" }))

    expect(onCommit).toHaveBeenCalledWith(["small"])
  })

  test("deselecting the only selected option commits null, not an empty array", () => {
    const onCommit = vi.fn()
    render(
      <ProfileScalarField
        config={SIZES_CONFIG}
        onCommit={onCommit}
        value={["small"]}
      />,
    )

    const smallButton = screen.getByRole("button", { name: "Small" })
    expect(smallButton).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(smallButton)

    expect(onCommit).toHaveBeenCalledWith(null)
  })

  test("selecting a second option keeps the exact literal values already selected", () => {
    const onCommit = vi.fn()
    render(
      <ProfileScalarField
        config={SIZES_CONFIG}
        onCommit={onCommit}
        value={["small"]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Large" }))

    expect(onCommit).toHaveBeenCalledWith(["small", "large"])
  })
})
