function parseConfig(configJson) {
  if (!configJson || !String(configJson).trim()) return {};
  try {
    const parsed = JSON.parse(configJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function postForm(url, formData) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(formData)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      body.append(k, String(v));
    }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) {
    throw new Error(data.error?.message || `HTTP ${resp.status}`);
  }
  return data;
}

async function postJson(url, payload, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) {
    throw new Error(data.error?.message || data.message || `HTTP ${resp.status}`);
  }
  return data;
}

async function publishViaWebhook(connection, post) {
  if (!connection.webhookUrl) {
    throw new Error('Webhook URL missing for this platform connection.');
  }

  const config = parseConfig(connection.configJson);
  const headers = {};
  if (connection.accessToken) {
    headers.Authorization = `Bearer ${connection.accessToken}`;
  }
  if (config.webhookSecret) {
    headers['X-Webhook-Secret'] = String(config.webhookSecret);
  }

  const payload = {
    platform: connection.platform,
    accountLabel: connection.accountLabel || null,
    externalAccountId: connection.externalAccountId || null,
    title: post.title,
    caption: post.caption,
    mediaUrl: post.mediaUrl || null,
    postId: post.id,
  };

  const data = await postJson(connection.webhookUrl, payload, headers);
  return { externalId: data.id || data.postId || null, raw: data };
}

async function publishFacebook(connection, post) {
  if (!connection.accessToken) throw new Error('Facebook access token missing.');
  if (!connection.externalAccountId) throw new Error('Facebook Page ID missing.');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const base = `https://graph.facebook.com/${version}/${connection.externalAccountId}`;

  if (post.mediaUrl) {
    const data = await postForm(`${base}/videos`, {
      access_token: connection.accessToken,
      file_url: post.mediaUrl,
      description: `${post.title}\n\n${post.caption}`.trim(),
    });
    return { externalId: data.id || null, raw: data };
  }

  const data = await postForm(`${base}/feed`, {
    access_token: connection.accessToken,
    message: `${post.title}\n\n${post.caption}`.trim(),
  });
  return { externalId: data.id || null, raw: data };
}

async function publishInstagram(connection, post) {
  if (!connection.accessToken) throw new Error('Instagram access token missing.');
  if (!connection.externalAccountId) throw new Error('Instagram User ID missing.');
  if (!post.mediaUrl) throw new Error('Instagram requires mediaUrl.');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const mediaResp = await postForm(`https://graph.facebook.com/${version}/${connection.externalAccountId}/media`, {
    access_token: connection.accessToken,
    media_type: 'REELS',
    video_url: post.mediaUrl,
    caption: `${post.title}\n\n${post.caption}`.trim(),
  });

  const creationId = mediaResp.id;
  if (!creationId) throw new Error('Instagram media creation failed (no creation id).');

  const publishResp = await postForm(`https://graph.facebook.com/${version}/${connection.externalAccountId}/media_publish`, {
    access_token: connection.accessToken,
    creation_id: creationId,
  });

  return { externalId: publishResp.id || creationId, raw: { mediaResp, publishResp } };
}

async function publishWhatsApp(connection, post) {
  if (!connection.accessToken) throw new Error('WhatsApp access token missing.');
  if (!connection.externalAccountId) throw new Error('WhatsApp phone_number_id missing.');

  const config = parseConfig(connection.configJson);
  const to = config.to;
  if (!to) throw new Error('WhatsApp destination number missing in configJson: {"to":"<number>"}.');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const url = `https://graph.facebook.com/${version}/${connection.externalAccountId}/messages`;
  const bodyText = `${post.title}\n\n${post.caption}`.trim();

  const payload = {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'text',
    text: { body: bodyText },
  };

  const data = await postJson(url, payload, {
    Authorization: `Bearer ${connection.accessToken}`,
  });

  const msgId = data.messages && data.messages[0] && data.messages[0].id ? data.messages[0].id : null;
  return { externalId: msgId, raw: data };
}

async function publishYouTube(connection, post) {
  // YouTube upload requires OAuth + local file upload flow.
  // Use webhook integration for production publishing.
  return publishViaWebhook(connection, post);
}

async function publishTikTok(connection, post) {
  // TikTok Content Posting API setup varies by approved app scopes.
  // Use webhook integration for production publishing.
  return publishViaWebhook(connection, post);
}

async function publishToPlatform({ platform, connection, post }) {
  if (!connection || connection.status !== 'connected') {
    throw new Error(`Platform ${platform} is not connected.`);
  }

  if (connection.webhookUrl) {
    return publishViaWebhook(connection, post);
  }

  switch (platform) {
    case 'facebook':
      return publishFacebook(connection, post);
    case 'instagram':
      return publishInstagram(connection, post);
    case 'whatsapp':
      return publishWhatsApp(connection, post);
    case 'youtube':
      return publishYouTube(connection, post);
    case 'tiktok':
      return publishTikTok(connection, post);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

module.exports = {
  publishToPlatform,
};
