import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jinja2|ico|webp|avif|jpg|jpeg|gif|png|svg|ttf|woff2?|mp4|mp3|wav|pdf|xml|zip|gz)).*)',
    '/(api|trpc)(.*)',
  ],
};
