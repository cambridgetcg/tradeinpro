// Use the parent project's Prisma client
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = await import('../../node_modules/@prisma/client/default.js');

const prisma = new PrismaClient();

export default prisma;
