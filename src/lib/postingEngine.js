const cron = require('node-cron');
const { prisma } = require('./prisma');
const { publishToPlatform } = require('./platformPublisher');

const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'whatsapp', 'youtube', 'tiktok'];

async function runPost(postId, actor = 'system') {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) {
    return { ok: false, reason: 'Post not found' };
  }

  if (post.status === 'posted') {
    return { ok: false, reason: 'Post already posted' };
  }

  const connections = await prisma.platformConnection.findMany({
    where: {
      userId: post.userId,
      platform: { in: post.platforms || [] },
    },
  });
  const connectionMap = new Map(connections.map((c) => [c.platform, c]));

  const results = [];
  const missing = [];

  for (const platform of post.platforms || []) {
    if (!ALLOWED_PLATFORMS.includes(platform)) continue;
    const connection = connectionMap.get(platform);

    if (!connection || connection.status !== 'connected') {
      missing.push(platform);
      results.push({ platform, ok: false, error: 'Platform not connected' });
      continue;
    }

    try {
      const pub = await publishToPlatform({ platform, connection, post });
      results.push({ platform, ok: true, externalId: pub.externalId || null });
      await prisma.postLog.create({
        data: {
          postId: post.id,
          userId: post.userId,
          platform,
          message: `Published successfully${pub.externalId ? ` (id: ${pub.externalId})` : ''}`,
          actor,
        },
      });
    } catch (err) {
      results.push({ platform, ok: false, error: err.message });
      await prisma.postLog.create({
        data: {
          postId: post.id,
          userId: post.userId,
          platform,
          message: `Publish failed: ${err.message}`,
          actor,
        },
      });
    }
  }

  const hasFailures = results.some((r) => !r.ok);
  const finalStatus = hasFailures ? 'failed' : 'posted';

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      status: finalStatus,
      postedAt: finalStatus === 'posted' ? new Date() : post.postedAt,
    },
  });

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Missing platform authentication: ${missing.join(', ')}`,
      missingPlatforms: missing,
      post: updated,
      results,
    };
  }

  if (hasFailures) {
    return {
      ok: false,
      reason: 'One or more platform publishes failed.',
      post: updated,
      results,
    };
  }

  return { ok: true, post: updated, results };
}

async function processDuePosts() {
  const duePosts = await prisma.post.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: {
        lte: new Date(),
      },
    },
    select: { id: true },
  });

  for (const post of duePosts) {
    await runPost(post.id, 'scheduler');
  }

  return duePosts.length;
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      await processDuePosts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Scheduler error:', err.message);
    }
  });
}

module.exports = {
  ALLOWED_PLATFORMS,
  runPost,
  processDuePosts,
  startScheduler,
};
