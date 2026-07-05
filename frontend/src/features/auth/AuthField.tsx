import type React from "react"

import { cn } from "@/lib/utils"

type AuthFieldProps = {
  id: string
  label: string
  error?: string
  description?: string
  children: React.ReactNode
}

export function AuthField({
  id,
  label,
  error,
  description,
  children,
}: AuthFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5" data-invalid={error ? "" : undefined}>
      <label className="text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      {children}
      {description && (
        <p className="text-sm text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      )}
      {error && (
        <p className={cn("text-sm text-destructive")} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
