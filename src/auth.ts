import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from './config';
import { HttpError } from './errors';
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    const p = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as { sub: string; role: Role; typ: string };
    if (p.typ !== 'access') throw new HttpError(401, 'Invalid access token');
    (req as Request & { auth: { userId: string; role: Role } }).auth = { userId: p.sub, role: p.role };
    next();
  } catch (e) { next(e instanceof HttpError ? e : new HttpError(401, 'Invalid or expired access token', 'INVALID_TOKEN')); }
}
export function roles(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = (req as Request & { auth?: { userId: string; role: Role } }).auth;
    if (!auth || !allowed.includes(auth.role)) return next(new HttpError(403, 'Insufficient permissions', 'FORBIDDEN'));
    next();
  };
}
export function current(req: Request) {
  const auth = (req as Request & { auth?: { userId: string; role: Role } }).auth;
  if (!auth) throw new HttpError(401, 'Authentication required');
  return auth;
}
