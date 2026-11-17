import { hashPassword } from './session-password'

// `pnpm admin:password <heslo>` — prints the value for ADMIN_PASSWORD_HASH.
const password = process.argv[2]
if (password === undefined || password.length < 8) {
  console.error('Usage: pnpm admin:password <password of at least 8 characters>')
  process.exit(1)
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`)
