import { clearAuthCookies, revokeSessionFromRequest } from '../../lib/auth';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  const headers = new Headers();
  const session = await revokeSessionFromRequest(context.request, context.env);

  await clearAuthCookies(headers, context.request);

  return json(
    {
      ok: true,
      signedOut: true,
      sessionCleared: Boolean(session),
      user: session
        ? {
            email: session.email,
            id: session.userId,
          }
        : null,
    },
    { headers, status: 200 },
  );
};
