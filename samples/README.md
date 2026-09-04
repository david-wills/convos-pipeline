# Sample output

Everything in this directory was written by `node src/cli.ts report` after one
end-to-end run against public podcast feeds and public news feeds. Nothing was
edited by hand. Start with **[REPORT.md](REPORT.md)**.

| File | What it is |
|---|---|
| `REPORT.md` | Human-readable tour: every story, which shows covered it, which segment, at what timestamp, with the verifier's score. Then every episode with its segment list. |
| `run.json` | Run metadata: when, which models, selection rules, counts, audio hours, Claude token usage and list-price cost. |
| `stories.json` | Every clustered story with its keywords, source headlines, trending score, status, and verified matches. Ranked by trending score. |
| `episodes/*.json` | One file per episode: feed metadata, the segments the pipeline produced (title, description, start/end, anchor phrase), and the speaker-labelled transcript at utterance granularity. Word-level timings are dropped here to keep files readable; the pipeline keeps them under `data/`. |
| `news-items.json` | The raw headlines that were clustered, with source and category. |

The static page at [`../viz/index.html`](../viz/index.html) renders `stories.json`
as a story-by-show view. Open it locally in a browser; it needs no server.

## Reading a story entry

```jsonc
{
  "title": "NVIDIA Acquires Hugging Face for $12.9 Billion",
  "keywords": ["NVIDIA", "Hugging Face", "acquisition", ...],   // drive candidate retrieval
  "sourceHeadlines": [{ "title": "...", "source": "BBC Technology" }, ...],
  "status": "active",            // candidate -> active on first verified match
  "trendingScore": 41.2,         // matches × mean relevance × (1 + 0.2 × shows) × decay
  "matches": [
    {
      "podcastTitle": "Tech Brew Ride Home",
      "episodeTitle": "Nvidia Buys Hugging Face For A Rabbit?",
      "convoTitle": "...",       // the segment the verifier scored
      "relevanceScore": 9,       // 0–10; only ≥ 7 is kept
      "startTime": 61.2, "endTime": 412.8,   // seconds into the episode audio
      "episodeFile": "2026-09-03-tech-brew-ride-home-nvidia-buys-hugging-face-for-a-rabbit.json"
    }
  ]
}
```
