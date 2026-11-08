import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set ADMIN_PASSWORD (minimum 12 characters) in .env before seeding.');
  const email = process.env.ADMIN_EMAIL ?? 'admin@flyover.local';
  await prisma.user.upsert({ where:{email}, update:{fullName:process.env.ADMIN_NAME??'Flyover Admin',passwordHash:await bcrypt.hash(password,12),role:Role.ADMIN,isActive:true}, create:{fullName:process.env.ADMIN_NAME??'Flyover Admin',email,passwordHash:await bcrypt.hash(password,12),role:Role.ADMIN,isEmailVerified:true} });
  console.log(`Admin ready: ${email}`);
}
main().finally(()=>prisma.$disconnect());
