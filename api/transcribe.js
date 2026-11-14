export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY in Vercel Environment Variables." });
    }

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ error: "No audio data received by server." });
    }

    let cleanMime = mimeType || "audio/mp4";
    if (cleanMime.includes("m4a") || cleanMime === "") {
      cleanMime = "audio/mp4";
    }

    // Put fastest low-latency models first and capture each model's exact error
    const attempts = [
      { model: "gemini-2.5-flash-lite", config: {} },
      { model: "gemini-3-flash-preview", config: { thinkingConfig: { thinkingLevel: "low" } } },
      { model: "gemini-3.8-flash", config: { thinkingConfig: { thinkingLevel: "low" } } }
    ];

    const errors = [];

    for (const { model, config } of attempts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 22000);

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

        const rawText = await geminiResponse.text();
        let data = {};
        try {
          data = JSON.parse(rawText);
        } catch {
          errors.push(`${model}: HTTP ${geminiResponse.status}`);
          continue;
        }

        if (geminiResponse.ok) {
          const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (!transcript.trim()) {
            return res.status(200).json({ error: "No speech detected in the audio file." });
          }
          return res.status(200).json({ transcript: transcript.trim() });
        }

        const errMsg = data?.error?.message || `HTTP ${geminiResponse.status}`;
        errors.push(`${model}: ${errMsg}`);

        if ([400, 404, 429, 500, 503].includes(geminiResponse.status)) {
          continue;
        }

        return res.status(geminiResponse.status).json({ error: errMsg });
      } catch (err) {
        errors.push(`${model}: ${err.name === "AbortError" ? "Timed out (22s)" : err.message}`);
      } finally {
        clearTimeout(timer);
      }
    }

    return res.status(503).json({ error: errors.join(" | ") });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}
