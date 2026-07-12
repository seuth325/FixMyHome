import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';

// Edge-safe config: no Prisma/bcrypt imports here so the middleware bundle
// (which uses this file, not the full src/auth.ts) stays lightweight.
const PUBLIC_ROUTES = [
  /^\/$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/profile(\/.*)?$/,
  /^\/api\/auth(\/.*)?$/, // NextAuth's own handlers + our /api/auth/register
];

export const authConfig = {
  pages: {
    signIn: '/sign-in',
  },
  session: {
    strategy: 'jwt',
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as 'HOMEOWNER' | 'HANDYMAN';
      }
      return session;
    },
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl;
      const isPublic = PUBLIC_ROUTES.some((re) => re.test(pathname));
      if (isPublic) return true;
      if (auth?.user) return true;

      // API routes should get a JSON 401, not an HTML redirect the caller can't follow.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const signInUrl = new URL('/sign-in', request.nextUrl);
      return NextResponse.redirect(signInUrl);
    },
  },
} satisfies NextAuthConfig;
