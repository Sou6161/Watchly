import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { verifyAccessToken } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

export interface AuthedRequest extends Request {
  user: User;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized();
    }

    const { sub } = verifyAccessToken(header.slice('Bearer '.length).trim());

    const user = await prisma.user.findUnique({ where: { id: sub } });
    if (!user) {
      // Token is validly signed but the account is gone.
      throw ApiError.unauthorized();
    }

    (req as AuthedRequest).user = user;
    next();
  } catch (err) {
    next(err);
  }
}
