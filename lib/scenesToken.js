// lib/scenesToken.js
//
// The plate routes take a photo and a list of scene lines and return
// photorealistic images of that face in those scenes. If the scene lines
// came straight from the client, that is a public face-swap service with
// our API key behind it. So /api/generate-book signs the scenes it wrote,
// and the plate routes only illustrate scenes that carry that signature —
// the same stateless HMAC the order-confirm link uses, same secret.

const { sign, verify } = require('./orderToken');

function signScenes(scenes, deps = {}) {
  return sign({ scenes: Array.isArray(scenes) ? scenes.map(String) : [] }, deps);
}

/** @returns {string[]} @throws .code 'invalid_token' | 'not_configured' */
function verifyScenes(token, deps = {}) {
  const summary = verify(token, deps);
  if (!summary || !Array.isArray(summary.scenes) || !summary.scenes.every((s) => typeof s === 'string')) {
    const err = new Error('invalid_scenes_token');
    err.code = 'invalid_token';
    throw err;
  }
  return summary.scenes;
}

module.exports = { signScenes, verifyScenes };
