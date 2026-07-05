export type LoginFormState = {
  email: string
  password: string
}

export type RegisterFormState = {
  name: string
  email: string
  password: string
  confirmPassword: string
}

export type FormErrors<T extends object> = Partial<Record<keyof T, string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateLogin(
  values: LoginFormState,
): FormErrors<LoginFormState> {
  const errors: FormErrors<LoginFormState> = {}
  const email = values.email.trim()
  if (!email) {
    errors.email = "Email is required."
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email."
  }
  if (!values.password) {
    errors.password = "Password is required."
  }
  return errors
}

export function validateRegister(
  values: RegisterFormState,
): FormErrors<RegisterFormState> {
  const errors: FormErrors<RegisterFormState> = {}
  const name = values.name.trim()
  const email = values.email.trim()

  if (!name) {
    errors.name = "Name is required."
  } else if (name.length < 3) {
    errors.name = "Name must be at least 3 characters."
  } else if (name.length > 80) {
    errors.name = "Name must be 80 characters or fewer."
  }

  if (!email) {
    errors.email = "Email is required."
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email."
  }

  if (!values.password) {
    errors.password = "Password is required."
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters."
  } else if (values.password.length > 128) {
    errors.password = "Password must be 128 characters or fewer."
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirm your password."
  } else if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match."
  }

  return errors
}

export function hasErrors<T extends object>(errors: FormErrors<T>): boolean {
  return Object.keys(errors).length > 0
}
