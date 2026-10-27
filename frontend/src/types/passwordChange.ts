export type PasswordChangeInput = {
  currentPassword: string
  newPassword: string
}
export type PasswordChangeValues = PasswordChangeInput & {
  confirmPassword: string
}
export type PasswordChangeErrors = Partial<
  Record<keyof PasswordChangeValues, string>
>
export type PasswordChangeApi = {
  change(input: PasswordChangeInput, signal?: AbortSignal): Promise<void>
}
