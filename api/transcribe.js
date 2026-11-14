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

    const { audioBase64, mimeType, textToTranslate, translateTo, textToSpeak } = req.body || {};
    if (!audioBase64 && !textToTranslate && !textToSpeak) {
      return res.status(400).json({ error: "No audio or text payload received by server." });
    }

    // --- Branch 1: Yorùbá Text-to-Speech (TTS) ---
    if (textToSpeak) {
      const ttsModels = ["gemini-2.5-flash-preview-tts", "gemini-2.5-flash"];
      for (const model of ttsModels) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18000);
        try {
          const ttsRes = await fetch(
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
                        text: `Read the following Yorùbá text aloud clearly and naturally with accurate Yorùbá pronunciation and tonal inflection (Do, Re, Mi):\n\n${textToSpeak}`
                      }
                    ]
                  }
                ],
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: "Aoede" }
                    }
                  }
                }
              })
            }
          );

          const rawText = await ttsRes.text();
          let data = {};
          try {
            data = JSON.parse(rawText);
          } catch {
            backlog.push(`${model}: non-JSON HTTP ${ttsRes.status}`);
            continue;
          }

          if (ttsRes.ok) {
            const inlineData = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
            if (inlineData?.data) {
              return res.status(200).json({
                audioBase64: inlineData.data,
                mimeType: inlineData.mimeType || "audio/wav"
              });
            }
          }
          backlog.push(`${model}: ${data?.error?.message || `HTTP ${ttsRes.status}`}`);
        } catch (err) {
          backlog.push(`${model}: ${err.message}`);
        } finally {
          clearTimeout(timer);
        }
      }
      return res.status(502).json({ error: "TTS unavailable: " + backlog.join(" | ") });
    }

    // --- Branch 2 & 3: Audio Transcription & Text Translation ---
    const targetLang =
      translateTo === "en" ? "English" :
      translateTo === "pt" ? "Portuguese" :
      translateTo === "yo" ? "Yorùbá (with full tonal marks and sub-dots)" : "";

    let parts = [];

    if (audioBase64) {
      let cleanMime = (mimeType || "audio/mp4").split(";")[0].trim();
      if (cleanMime.includes("m4a") || cleanMime === "") {
        cleanMime = "audio/mp4";
      }

      backlog.push(`[${stamp()}] Received audio (${Math.round(audioBase64.length * 0.75 / 1024)} KB, mime: ${cleanMime}, translate: ${targetLang || "none"})`);

      const promptText = targetLang
        ? `Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ), and provide a natural ${targetLang} translation. Format the output cleanly as:\nYorùbá: <transcription>\n${targetLang}: <translation>`
        : "Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the Yorùbá transcription.";

      parts = [
        { text: promptText },
        { inline_data: { mime_type: cleanMime, data: audioBase64 } }
      ];
    } else {
      backlog.push(`[${stamp()}] Translating text (${textToTranslate.length} chars) -> ${targetLang || "English"}`);
      const lang = targetLang || "English";
      parts = [
        {
          text: `Translate the following text into ${lang}. If the source or target is Yorùbá, preserve or apply accurate standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the translation:\n\n${textToTranslate}`
        }
      ];
    }

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
              contents: [{ parts }]
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
            return res.status(200).json({ error: "No speech or text output returned.", backlog });
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
