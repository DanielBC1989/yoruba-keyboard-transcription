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

    // Try primary model first, then automatically fall back if experiencing high demand
    const models = [
      "gemini-3.8-flash",
      "gemini-2.5-flash-lite",
      "gemini-3-flash-preview"
    ];

    let lastError = "Gemini API error";

    for (const model of models) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      try {
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
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
          lastError = `Non-JSON response (${geminiResponse.status}) from ${model}`;
          continue;
        }

        if (geminiResponse.ok) {
          const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (!transcript.trim()) {
            return res.status(200).json({ error: "No speech detected in the audio file." });
          }
          return res.status(200).json({ transcript: transcript.trim() });
        }

        lastError = data?.error?.message || `HTTP ${geminiResponse.status} from ${model}`;

        // Retry with the next model on temporary overload (503/429) or model unavailability (404)
        if ([404, 429, 500, 503].includes(geminiResponse.status)) {
          continue;
        }

        return res.status(geminiResponse.status).json({ error: lastError });
      } catch (err) {
        lastError = err.name === "AbortError" ? `Timeout on ${model}` : err.message;
      } finally {
        clearTimeout(timer);
      }
    }

    return res.status(503).json({ error: `All models busy. Last error: ${lastError}` });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}
