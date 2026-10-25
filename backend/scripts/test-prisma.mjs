import { getPrisma, disconnectDatabase } from '../database/client.mjs'

try {
  console.log('1. Đang khởi tạo Prisma Client...')

  const prisma = await getPrisma()
  console.log('2. PRISMA CLIENT OK')

  console.log('3. Đang thử truy vấn PostgreSQL...')

  const result = await prisma.$queryRaw`
    SELECT current_database() AS database,
           current_user AS username
  `

  console.log('4. PRISMA QUERY OK')
  console.log(result)
} catch (error) {
  console.error('ERROR NAME:', error.name)
  console.error('ERROR CODE:', error.code ?? error.cause?.code ?? 'unknown')
  console.error(
    'ERROR KIND:',
    error.meta?.driverAdapterError?.cause?.kind ?? 'unknown'
  )
} finally {
  await disconnectDatabase().catch(() => {})
}