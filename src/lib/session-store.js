const session = require('express-session');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function serializeSessionData(sess) {
  return JSON.parse(JSON.stringify(sess || {}));
}

function resolveExpiry(sess) {
  const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires) : null;
  if (expires && !Number.isNaN(expires.getTime())) {
    return expires;
  }
  const maxAge = Number(sess?.cookie?.maxAge);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    return new Date(Date.now() + maxAge);
  }
  return new Date(Date.now() + DEFAULT_TTL_MS);
}

class PrismaSessionStore extends session.Store {
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  async get(sid, callback = () => {}) {
    try {
      const record = await this.prisma.appSession.findUnique({ where: { sid } });
      if (!record) {
        return callback(null, null);
      }
      if (record.expiresAt.getTime() <= Date.now()) {
        await this.prisma.appSession.delete({ where: { sid } }).catch(() => {});
        return callback(null, null);
      }
      return callback(null, record.data);
    } catch (error) {
      return callback(error);
    }
  }

  async set(sid, sess, callback = () => {}) {
    try {
      const serializedSession = serializeSessionData(sess);
      await this.prisma.appSession.upsert({
        where: { sid },
        create: {
          sid,
          data: serializedSession,
          expiresAt: resolveExpiry(sess),
        },
        update: {
          data: serializedSession,
          expiresAt: resolveExpiry(sess),
        },
      });
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.prisma.appSession.delete({ where: { sid } }).catch(() => {});
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  async touch(sid, sess, callback = () => {}) {
    try {
      const serializedSession = serializeSessionData(sess);
      await this.prisma.appSession.update({
        where: { sid },
        data: {
          data: serializedSession,
          expiresAt: resolveExpiry(sess),
        },
      }).catch(async () => {
        await this.prisma.appSession.create({
          data: {
            sid,
            data: serializedSession,
            expiresAt: resolveExpiry(sess),
          },
        });
      });
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }
}

module.exports = { PrismaSessionStore };
