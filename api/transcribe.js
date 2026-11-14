module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const backlog = [];
  const startAll = Date.now();
  const stamp = () => "+" + ((Date.now() - startAll) / 1000).toFixed(2) + "s";

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY in Vercel Environment Variables." });
    }

    const body = req.body ? req.body : {};
    const audioBase64 = body.audioBase64;
    const mimeType = body.mimeType;
    const textToTranslate = body.textToTranslate;
    const translateTo = body.translateTo;
    const textToSpeak = body.textToSpeak;

    if (!audioBase64 && !textToTranslate && !textToSpeak) {
      return res.status(400).json({ error: "No audio or text payload received by server." });
    }

    // 1. Multilingual Text-to-Speech (Yoruba, English, Portuguese)
    if (textToSpeak) {
      const ttsModels = ["gemini-2.5-flash-preview-tts", "gemini-3.8-flash"];
      for (let i = 0; i < ttsModels.length; i++) {
        const model = ttsModels[i];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18000);
        try {
          const ttsRes = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text: "Read the following text aloud clearly and naturally, switching seamlessly between Yoruba (with accurate tonal marks Do, Re, Mi), English, and Portuguese as written:\n\n" + textToSpeak
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
          } catch (e) {
            backlog.push(model + ": non-JSON HTTP " + ttsRes.status);
            continue;
          }

          if (ttsRes.ok) {
            let partsList = [];
            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
              partsList = data.candidates[0].content.parts;
            }
            const audioPart = partsList.find(p => Boolean(p.inline_data) || Boolean(p.inlineData));
            const inlineObj = audioPart ? (audioPart.inline_data ? audioPart.inline_data : audioPart.inlineData) : null;
            if (inlineObj && inlineObj.data) {
              const outMime = inlineObj.mime_type ? inlineObj.mime_type : (inlineObj.mimeType ? inlineObj.mimeType : "audio/L16;rate=24000");
              return res.status(200).json({
                audioBase64: inlineObj.data,
                mimeType: outMime
              });
            }
            backlog.push(model + ": HTTP 200 without audio");
            continue;
          }

          const ttsErr = (data.error && data.error.message) ? data.error.message : ("HTTP " + ttsRes.status);
          backlog.push(model + ": " + ttsErr);
        } catch (err) {
          backlog.push(model + ": " + err.message);
        } finally {
          clearTimeout(timer);
        }
      }
      return res.status(502).json({ error: "TTS unavailable: " + backlog.join(" | ") });
    }

    // 2. Audio Transcription & Two-Way Translation
    let targetLang = "";
    if (translateTo === "en") targetLang = "English";
    else if (translateTo === "pt") targetLang = "Portuguese";
    else if (translateTo === "yo") targetLang = "Yoruba (with full tonal marks and sub-dots)";

    let parts = [];

    if (audioBase64) {
      const baseMime = mimeType ? mimeType : "audio/mp4";
      let cleanMime = baseMime.split(";")[0].trim();
      if (cleanMime.includes("m4a") || cleanMime === "") {
        cleanMime = "audio/mp4";
      }

      backlog.push("[" + stamp() + "] Received audio (" + Math.round(audioBase64.length * 0.75 / 1024) + " KB, mime: " + cleanMime + ")");

      const promptText = targetLang
        ? "Transcribe this audio accurately (preserving standard Yoruba orthography with full tonal marks ami ohun and sub-dots e, o, s if spoken in Yoruba), and provide a natural " + targetLang + " translation. Format cleanly without markdown asterisks as:\nTranscription: <transcription>\n" + targetLang + ": <translation>"
        : "Transcribe this Yoruba audio accurately using standard Yoruba orthography with full tonal marks (ami ohun) and sub-dots (e, o, s). Return only the Yoruba transcription.";

      parts = [
        { text: promptText },
        { inline_data: { mime_type: cleanMime, data: audioBase64 } }
      ];
    } else {
      const lang = targetLang ? targetLang : "English";
      backlog.push("[" + stamp() + "] Translating text (" + textToTranslate.length + " chars) -> " + lang);
      parts = [
        {
          text: "Translate the following text into " + lang + ". If the source or target is Yoruba, preserve or apply accurate standard Yoruba orthography with full tonal marks (ami ohun) and sub-dots (e, o, s). Return only the translation without markdown formatting:\n\n" + textToTranslate
        }
      ];
    }

    const attempts = [
      { model: "gemini-3.5-flash-lite", config: {} },
      { model: "gemini-3-flash-preview", config: { thinkingConfig: { thinkingLevel: "low" } } },
      { model: "gemini-3.8-flash", config: { thinkingConfig: { thinkingLevel: "low" } } }
    ];

    for (let i = 0; i < attempts.length; i++) {
      const model = attempts[i].model;
      const config = attempts[i].config;
      const attemptStart = Date.now();
      backlog.push("[" + stamp() + "] Trying " + model + "...");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

      try {
        const geminiResponse = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              generationConfig: config,
              contents: [{ parts: parts }]
            })
          }
        );

        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(2);
        const rawText = await geminiResponse.text();
        let data = {};
        try {
          data = JSON.parse(rawText);
        } catch (e) {
          backlog.push("[" + stamp() + "] " + model + " failed in " + elapsed + "s -> HTTP " + geminiResponse.status);
          continue;
        }

        if (geminiResponse.ok) {
          let transcript = "";
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) {
            transcript = data.candidates[0].content.parts[0].text;
          }
          backlog.push("[" + stamp() + "] " + model + " succeeded in " + elapsed + "s!");
          if (!transcript.trim()) {
            return res.status(200).json({ error: "No speech or text output returned.", backlog: backlog });
          }
          return res.status(200).json({ transcript: transcript.trim(), backlog: backlog });
        }

        const errMsg = (data.error && data.error.message) ? data.error.message : ("HTTP " + geminiResponse.status);
        backlog.push("[" + stamp() + "] " + model + " failed in " + elapsed + "s -> HTTP " + geminiResponse.status + ": " + errMsg);

        if ([400, 404, 429, 500, 503].includes(geminiResponse.status)) {
          continue;
        }

        return res.status(geminiResponse.status).json({ error: errMsg, backlog: backlog });
      } catch (err) {
        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(2);
        const reason = err.name === "AbortError" ? "Aborted after 18s timeout" : err.message;
        backlog.push("[" + stamp() + "] " + model + " exception in " + elapsed + "s -> " + reason);
      } finally {
        clearTimeout(timer);
      }
    }

    return res.status(503).json({
      error: "All models failed. See backlog below.",
      backlog: backlog
    });
  } catch (err) {
    backlog.push("[" + stamp() + "] Fatal server exception -> " + err.message);
    return res.status(500).json({ error: err.message ? err.message : "Unexpected server error", backlog: backlog });
  }
};
