import express from 'express';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export function installCloudRecording(app) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.RECORDING_SESSION_SECRET;
  const bucket = 'recordings';
  const enabled = Boolean(base && key && secret);
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  function session(req) {
    if (!enabled) return null;
    const [id, signature] = (req.get('X-Recording-Session') || '').split('.');
    if (!/^[a-f0-9-]{36}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id))) ? id : null;
  }
  async function upload(id, name, body, type) {
    const response = await fetch(`${base}/storage/v1/object/${bucket}/${id}/${name}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': type, 'x-upsert': 'true' },
      body, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('云端保存失败，请重试');
  }
  app.get('/api/recording/config', (req, res) => res.json({ enabled }));
  app.post('/api/recording/session', async (req, res) => {
    if (!enabled) return res.status(503).json({ error: '云端记录尚未配置' });
    if (req.body?.consent !== true) return res.status(400).json({ error: '需要家长同意' });
    const id = randomUUID();
    try {
      await upload(id, 'consent.json', JSON.stringify({ consentAt: new Date().toISOString(), version: 1 }), 'application/json');
      res.json({ token: `${id}.${sign(id)}` });
    } catch { res.status(503).json({ error: '无法连接云端存储' }); }
  });
  app.post('/api/recording/upload', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
    const id = session(req);
    if (!id) return res.status(401).json({ error: '记录会话无效' });
    const name = req.get('X-Recording-File') || '';
    if (!/^[a-f0-9-]{36}\.(json|webm|mp4|mp3|wav)$/.test(name) || !Buffer.isBuffer(req.body)) return res.sendStatus(400);
    const type = req.get('Content-Type') || '';
    if (!/^(audio\/|application\/json)/.test(type)) return res.sendStatus(415);
    try { await upload(id, name, req.body, type); res.json({ saved: true }); }
    catch { res.status(503).json({ error: '云端保存失败' }); }
  });
}
