import { Router } from 'express';
import { z } from 'zod';
import { REGIONS, SERVICE_IDS, servicesForRegion, type Region } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError, wrap } from '../lib/errors.js';
import { toPublicUser } from '../lib/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js';
import { parseBody } from '../lib/validate.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', (req, res) => {
  res.json(toPublicUser((req as AuthedRequest).user));
});

const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    region: z.enum(REGIONS).optional(),
    services: z
      .array(z.enum(SERVICE_IDS as [string, ...string[]]))
      .max(SERVICE_IDS.length)
      .optional(),
    partnerId: z.string().nullable().optional(),
  })
  .strict();

meRouter.patch(
  '/',
  wrap(async (req, res) => {
    const me = (req as AuthedRequest).user;
    const patch = parseBody(updateSchema, req.body);

    // Services must be valid for the region the user will be in *after* this
    // patch — otherwise switching IN -> US would silently leave Zee5 selected
    // and the title queue would filter against a provider that isn't there.
    const region: Region = patch.region ?? (me.region as Region);
    if (patch.services) {
      const allowed = new Set(servicesForRegion(region).map((s) => s.id));
      const stray = patch.services.filter((s) => !allowed.has(s));
      if (stray.length > 0) {
        throw ApiError.badRequest(
          `These services aren't available in ${region}: ${stray.join(', ')}.`,
          { services: `Not available in ${region}: ${stray.join(', ')}` },
        );
      }
    }

    // Changing region without resending services would strand the old region's
    // services on the account, so drop any that no longer apply.
    let services = patch.services;
    if (patch.region && !patch.services) {
      const allowed = new Set(servicesForRegion(region).map((s) => s.id));
      services = me.services.filter((s) => allowed.has(s));
    }

    if (patch.partnerId) {
      if (patch.partnerId === me.id) {
        throw ApiError.badRequest('You cannot save yourself as a partner.');
      }
      const partner = await prisma.user.findUnique({ where: { id: patch.partnerId } });
      if (!partner) throw ApiError.notFound('That partner no longer exists.');
    }

    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        ...(patch.displayName !== undefined && { displayName: patch.displayName }),
        ...(patch.region !== undefined && { region: patch.region }),
        ...(services !== undefined && { services }),
        ...(patch.partnerId !== undefined && { partnerId: patch.partnerId }),
      },
    });

    res.json(toPublicUser(updated));
  }),
);
