import { NextResponse } from 'next/server';
import { isAdminAuthorized } from './lib/admin-auth';

export function proxy(request) {
  if (isAdminAuthorized(request.headers.get('authorization'))) {
    return NextResponse.next();
  }
  return new NextResponse('認証が必要です', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="admin", charset="UTF-8"' },
  });
}

export const config = {
  matcher: '/admin/:path*',
};
