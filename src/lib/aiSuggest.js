function buildFallback({ topic, audience, tone, goal, platform }) {
  const safeTopic = (topic || 'your story').trim();
  const safeAudience = (audience || 'your audience').trim();
  const safeTone = (tone || 'authentic').trim();
  const safeGoal = (goal || 'engagement').trim();
  const safePlatform = (platform || 'social media').trim();

  const title = `${safeTopic}: ${safeTone} insight for ${safeAudience}`.slice(0, 90);
  const caption = [
    `I want to share this with ${safeAudience}.`,
    `Topic: ${safeTopic}.`,
    `Tone: ${safeTone}.`,
    `Goal: ${safeGoal} on ${safePlatform}.`,
    'If this helps, comment your take and follow for the next one.'
  ].join(' ');

  return { title, caption };
}

async function requestOpenAI({ topic, audience, tone, goal, platform }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const prompt = `Create ONE social media post recommendation.\nReturn strict JSON: {"title":"...","caption":"..."}.\nConstraints:\n- title <= 90 chars\n- caption <= 300 chars\n- concise, no hashtags unless necessary\nInputs:\n- topic: ${topic || ''}\n- audience: ${audience || ''}\n- tone: ${tone || ''}\n- goal: ${goal || ''}\n- platform: ${platform || ''}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You are a social media copywriter. Return valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content);
  if (!parsed.title || !parsed.caption) return null;

  return {
    title: String(parsed.title).slice(0, 90),
    caption: String(parsed.caption).slice(0, 300),
  };
}

async function generateRecommendation(input) {
  try {
    const ai = await requestOpenAI(input);
    if (ai) return { ...ai, source: 'openai' };
  } catch (err) {
    // fallback below
  }

  const fallback = buildFallback(input);
  return { ...fallback, source: 'fallback' };
}

module.exports = { generateRecommendation };
