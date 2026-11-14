export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY environment variable." });
    }

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ error: "No audio payload received." });
    }

    // Normalize non-standard browser MIME types (e.g., iPhone Voice Memos)
    let cleanMime = mimeType || "audio/mp3";
    if (cleanMime === "audio/x-m4a" || cleanMime === "audio/m4a") {
      cleanMime = "audio/mp4";
    }

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: {
            thinkingConfig: { thinkingLevel: "low" }
          },
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
      return res.status(502).json({ error: `Unexpected Gemini response (${geminiResponse.status}): ${rawText.slice(0, 140)}` });
    }

    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({ error: data?.error?.message || "Gemini API error" });
    }

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!transcript.trim()) {
      return res.status(200).json({ error: "No speech detected in the audio file." });
    }

    return res.status(200).json({ transcript: transcript.trim() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}
