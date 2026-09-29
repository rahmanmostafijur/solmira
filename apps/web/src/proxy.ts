import { SESSION_HINT_COOKIE } from '@solmira/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { decideRoute } from './lib/routing';

/** Routes signed-out visitors before any page renders. Authorization itself happens in the API. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = decideRoute(pathname, search, request.cookies.has(SESSION_HINT_COOKIE));
  if (decision.action === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|healthz|icon|favicon|robots\\.txt).*)'],
};
