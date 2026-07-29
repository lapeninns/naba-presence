process.env.NEXTAUTH_SECRET ??= "route-harness-secret-value-32-characters!"
process.env.TOKEN_ENCRYPTION_KEY ??= "route-harness-token-key-32-characters!!"
process.env.CRON_SECRET ??= "route-harness-cron-secret"
process.env.DATABASE_URL ??= process.env.TEST_RUNTIME_DATABASE_URL ?? ""
