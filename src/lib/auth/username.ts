// Staff log in with a User ID + PIN. Internally each User ID maps to a synthetic
// email used as the Supabase Auth identity. Login and employee provisioning must
// share this exact transform, so it lives in one place.
export const EMPLOYEE_EMAIL_DOMAIN = 'chidentallab.local'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${EMPLOYEE_EMAIL_DOMAIN}`
}

// User IDs become the local-part of an email, so keep them to safe characters.
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,30}$/
