export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const backlog = [];
  const startAll = Date.now();
  const stamp = () => `+${((Date.now() - startAll) / 1000).toFixed(2)}s`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY in Vercel Environment Variables." });
    }

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ error: "No audio data received by server." });
    }

    let cleanMime = (mimeType || "audio/mp4").split(";")[0].trim();
    if (cleanMime.includes("m4a") || cleanMime === "") {
      cleanMime = "audio/mp4";
    }
    
    backlog.push(`[${stamp()}] Received payload (${Math.round(audioBase64.length * 0.75 / 1024)} KB, mime: ${cleanMime})`);

    const attempts = [
      { model: "gemini-2.5-flash-lite", config: {} },
      { model: "gemini-3-flash-preview", config: { thinkingConfig: { thinkingLevel: "low" } } },
      { model: "gemini-3.8-flash", config: { thinkingConfig: { thinkingLevel: "low" } } }
    ];

    for (const { model, config } of attempts) {
      const attemptStart = Date.now();
      backlog.push(`[${stamp()}] Trying ${model}...`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

      try {
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              generationConfig: config,
              contents: [
                {
                  parts: [
                    {
                      text: "Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the Yorùbá transcription."
                    },
                    {
                      inline_data: {
                        mime_type: cleanMime,
                        data: audioBase64
                      }
                    }
                  ]
                }
              ]
            })
          }
        );

        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(2);
        const rawText = await geminiResponse.text();
        let data = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          backlog.push(`[${stamp()}] ${model} failed in ${elapsed}s -> HTTP ${geminiResponse.status} (non-JSON): ${rawText.slice(0, 120)}`);
          continue;
        }

        if (geminiResponse.ok) {
          const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          backlog.push(`[${stamp()}] ${model} succeeded in ${elapsed}s!`);
          if (!transcript.trim()) {
            return res.status(200).json({ error: "No speech detected in the audio file.", backlog });
          }
          return res.status(200).json({ transcript: transcript.trim(), backlog });
        }

        const errMsg = data?.error?.message || `HTTP ${geminiResponse.status}`;
        backlog.push(`[${stamp()}] ${model} failed in ${elapsed}s -> HTTP ${geminiResponse.status}: ${errMsg}`);

        if ([400, 404, 429, 500, 503].includes(geminiResponse.status)) {
          continue;
        }

        return res.status(geminiResponse.status).json({ error: errMsg, backlog });
      } catch (err) {
        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(2);
        const reason = err.name === "AbortError" ? "Aborted after 18s timeout" : err.message;
        backlog.push(`[${stamp()}] ${model} exception in ${elapsed}s -> ${reason}`);
      } finally {
        clearTimeout(timer);
      }
    }

    return res.status(503).json({
      error: "All models failed. See backlog below.",
      backlog
    });
  } catch (err) {
    backlog.push(`[${stamp()}] Fatal server exception -> ${err.message}`);
    return res.status(500).json({ error: err.message || "Unexpected server error", backlog });
  }
}
