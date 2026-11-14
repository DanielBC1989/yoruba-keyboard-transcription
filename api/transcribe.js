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

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Transcribe this Yorùbá audio accurately using standard Yorùbá orthography with full tonal marks (àmì ohùn) and sub-dots (ẹ, ọ, ṣ). Return only the Yorùbá transcription."
                },
                {
                  inline_data: {
                    mime_type: mimeType || "audio/mp3",
                    data: audioBase64
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const data = await geminiResponse.json();
    if (!geminiResponse.ok) {
      return res.status(geminiResponse.status).json({ error: data?.error?.message || "Gemini API error" });
    }

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.status(200).json({ transcript: transcript.trim() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}
