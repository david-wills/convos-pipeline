# convos-pipeline

Given a list of podcast feeds and a list of news feeds, find the moments where different shows discuss the same story.

This is the backend pipeline from [Convos](https://convospodcasts.com), a podcast app I'm building. The app is not here; the pipeline is, standalone and runnable: transcribe episodes, split them into topical segments with Claude, cluster news headlines into stories, and verify which segments cover which stories.

**If you have sixty seconds:** open [`samples/REPORT.md`](samples/REPORT.md). It is the unedited output of one run over 39 episodes from 20 news podcasts published 2–4 September 2026. Each story lists the shows that covered it, the exact segment, the timestamp, and the verifier's score. [`samples/episodes/`](samples/episodes/) has every episode's segments and transcript. `viz/index.html` shows the same thing interactively if you open it locally.

Then read [Where it breaks](#where-it-breaks). That section is the point of publishing this.

![Stories on the left; for each, the shows and segments that covered it, with where in the episode the segment sits](viz/screenshot.png)

## What it does

```mermaid
flowchart LR
  subgraph episodes [Per episode]
    A[Podcast RSS] --> B[Select by rule]
    B --> C[AssemblyAI<br/>utterances + word timings]
    C --> D[Claude Sonnet<br/>topic segments]
  end
  subgraph stories [Per run]
    E[News RSS<br/>9 feeds] --> F[Claude Haiku<br/>cluster into stories<br/>+ keywords]
    F --> G[Merge with<br/>existing stories]
  end
  D --> H[Keyword search<br/>segment title + description]
  G --> H
  D --> H2[Embeddings, Voyage<br/>same text, top 25 by cosine]
  G --> H2
  H --> I[Claude Haiku, shown the story<br/>score 0–10, keep ≥ 8]
  H2 --> I
  I --> J[Trending score<br/>rank + activate]
```

Every stage writes JSON to `data/` and skips work that already has output, so an interrupted run resumes without paying twice.

## The approach

### Segmentation: a model that reads the whole episode decides where topics change

The segmenter receives the entire transcript as timestamped speaker turns, plus the feed's title, description, and duration. It returns a list of start times, each with a three-to-seven-word title written like a magazine headline and a one-sentence description. The prompt ([`prompts/segment.md`](prompts/segment.md)) scales the expected segment count with episode length and spends most of its words on paired examples of bad and good titles. The examples do the work; the rules are short.

I chose model-drawn boundaries over fixed windows or embedding change-point detection for one reason: the segments are the app's navigation unit, so they have to be boundaries a listener would agree with *and* carry titles worth tapping. A change-point detector gives boundaries but no titles, and the boundaries it finds (lexical shifts) are not the ones people navigate by. One model call that sees everything does both at once, and it can use the episode description to know what the show is about before the hosts get to it.

What the model is not trusted with is handled in code ([`src/segment.ts`](src/segment.ts)):

- **The first segment starts at 0:00** whatever the model says. Every episode has a top.
- **Starts snap to the nearest utterance boundary** when one is within 30 seconds, so a segment never begins mid-sentence. Ends are the next segment's start.
- **Utterances longer than 45 seconds are split at sentence ends using word timings** before the model sees them. Diarization returns one utterance for a whole monologue on single-host shows, and without timestamps inside it the model has nothing to anchor boundaries to. This was found on this run; see below.
- **A 15-word anchor phrase is captured at each start.** The audio a listener downloads is not the audio that was transcribed: dynamic ad insertion pads episodes by a varying amount. On this run the transcribed audio was up to 7.8 minutes longer than the feed's declared duration (median about 1.7 minutes). The app runs on-device speech recognition near the expected time and searches for the anchor phrase to re-align. Recording it at generation time costs nothing.

Sonnet is used here because the task is generative and its quality is visible in every title. The two remaining model calls are classification-shaped and go to Haiku at temperature 0.

### Stories: "same story" has an operational definition

Headlines come from nine public feeds (BBC sections, NPR, Ars Technica, Google News). They are deduplicated on title plus source and handed to Haiku 75 at a time, newest first. The prompt ([`prompts/cluster-stories.md`](prompts/cluster-stories.md)) asks for groups of at least two headlines, at most ten groups per call, and for each group a title, a summary, a category, and three to six keywords that are proper nouns or event names, explicitly not generic words. The keywords exist for retrieval; the title and summary exist for the reader.

Each new cluster is merged into the running story list by one rule: if it shares two or more keywords (exact match, case-insensitive) with a live story, it *is* that story, and the headlines and keywords are unioned. Otherwise it becomes a new story. In production this ran every 30 minutes and stories accumulated across a day; the standalone command runs the batches back to back.

So, operationally: a story is a set of headlines the clusterer grouped, identified by its keyword set, and two clusters are the same story when they share two keywords. That is a deliberately blunt rule. Both of its failure directions show up in the sample and are catalogued below.

### Matching: two cheap retrievers, then a model for precision

For each story, stage one produces candidates two ways and unions them ([`src/match.ts`](src/match.ts)). Keyword search: any story keyword, matched as a whole word, in a segment's title or description. Embeddings: the story's title, summary and keywords, and each segment's title and description, are embedded with Voyage AI ([`src/embed.ts`](src/embed.ts)), and the 25 nearest segments by cosine similarity above a floor of 0.45 are candidates. Both retrievers read the same thirty-odd words per segment; no transcript text is searched or embedded. Candidates are capped at 200, newest episodes first.

Stage two is Haiku, in calls of at most 50 candidates per story ([`prompts/verify-match-context.md`](prompts/verify-match-context.md)). It is shown the story's title, summary, keywords and source headlines, then every candidate's episode title, segment title and description, and it scores each 0–10 with the instruction that the same beat is not the same event. Only 8 and above survive.

The shape is deliberate. Stage one is nearly free: keyword search has good recall for proper nouns, which is what the keyword prompt asks for, and embeddings catch the segment that says "Steinem" when the keyword is "Gloria Steinem". Stage two is where precision comes from, and it is cheap because it reads about fifty tokens per candidate. A segment "covers" a story when either retriever surfaces it *and* the verifier rates it 8 or better.

None of that is what shipped. Production used keyword search as a substring match, a verifier shown only the story title and category ([`prompts/verify-match.md`](prompts/verify-match.md)), and a cutoff of 7. The v0.8 plan scoped semantic search and priced Cloudflare Vectorize against Pinecone and Weaviate; it was never reached, and the app's backend never had a vector store. The switch to union retrieval, the story-aware verifier and the cutoff of 8 came out of a measured comparison on this sample, which is below. `--retriever keyword --verifier production` with `"minScore": 7` in `feeds.json` reproduces the original.

### Ranking

```
trending = matches × mean relevance × (1 + 0.2 × distinct shows) × 0.5 ^ (age in days / 3)
```

Coverage by several different shows is rewarded on top of raw match count because the product promise is "every show covering this", not "the show that covered it most". A story becomes active on its first verified match and is archived when its score decays under 0.5. The activation threshold was two matches until a production run showed a sparsely-transcribed catalog kept the feature empty; it was lowered to one. That is the kind of knob this pipeline has instead of an eval set, which is one of the limitations below.

### Cost shape

Per episode: one transcription (billed by audio hour), one Sonnet call whose input is the whole transcript, and about forty embedding tokens per segment. Per run: one Haiku call per 75 headlines and one Haiku call per 50 candidates per story. The sample run's `run.json` records 14.4 hours of audio and the exact token counts; at list prices the Claude portion of the whole run was under $2 and the embeddings were a fiftieth of a cent. The verifier's budget is bounded on the embedding side at 25 candidates per story, which keyword search never was.

Production had one more cost control that is not in the standalone CLI because it needs a catalog to be selective over: only a seeded set of shows had recent episodes transcribed automatically, and other episodes were transcribed on demand when two or more of a story's keywords hit the episode title, capped at ten per day. The stories drove the transcription budget, not the other way round.

## What came out of the sample run

Run on 4 September 2026 with the configuration in `feeds.json`; matching was re-run on 6 September under the current defaults over the same transcripts, segments and stories. Full output is in [`samples/`](samples/), and [`viz/screenshot.png`](viz/screenshot.png) shows the interactive view.

| | |
|---|---|
| Episodes | 39 from 20 shows, published 2–4 September, 14.4 hours of audio |
| Segments | 267, from 20 seconds to 8.5 minutes long |
| Headlines | 270 from 9 feeds, clustered in 4 batches |
| Stories | 37, of which 9 have verified podcast coverage and 7 are covered by two or more shows |
| Verified matches | 35, at a cutoff of 8 |
| Claude cost | $1.07 at list price: segmentation $0.99, clustering $0.04, verification $0.04. Embeddings $0.0002 |
| Wall time | about nine minutes, most of it transcription and segmentation running four calls at a time |

The result the pipeline exists to produce, taken from `REPORT.md`:

**Nvidia acquires Hugging Face for $12.9 billion.** Three headlines from three outlets became one story. Keyword search pulled 41 candidate segments and embeddings added 5; the verifier kept five, across three shows:

| Show | Segment | Time | Score |
|---|---|---|---|
| Tech Brew Ride Home | Nvidia's $12.9B Hugging Face Bet | 0:03–4:00 | 10 |
| Tech Brew Ride Home | Why 86x Revenue Makes Sense | 8:16–12:09 | 9 |
| Reuters World News | Nvidia's $13 Billion AI Gamble | 5:17–6:45 | 9 |
| Reuters World News | Open Source vs. China's AI Push | 6:45–7:27 | 9 |
| FT News Briefing | Nvidia Swallows the AI Ecosystem | 7:36–11:30 | 9 |

The 41 rejected candidates include The Intelligence's episode on Nvidia as "the bank of AI" (vendor financing, not the acquisition), The Daily's episode on an AI-agent attack on Hugging Face, and Tech Brew's segment on Hugging Face's robot as the reason for Nvidia's price. The first two mention the right companies for the wrong story and were rejected by the pipeline as it shipped too. The third is analysis of the deal rather than the deal; the shipped verifier scored it 9, this one scores it under 8, and it is the price of the stricter prompt.

Gloria Steinem's death was found in 12 segments across 4 shows, four of them surfaced only by embeddings; the Nepal tunnel rescue in 4 across 3; the August jobs report in 4 across 2; and the Lindsay Clancy mistrial in 3 across 3.

### Keyword search against embeddings

This is why the defaults are what they are. The pipeline as extracted used keyword search, a verifier shown only the story title, and a cutoff of 7. `node src/cli.ts compare --verifier production` ran keyword search and the embedding retriever over the same 37 stories and 267 segments, then had that verifier score the union of their candidates once. The full output is [`samples/retrieval-comparison.md`](samples/retrieval-comparison.md). The whole comparison cost $0.10.

| Retriever | Candidates sent to the verifier | Verified at 7 or more | Stories with coverage | Verified that only this retriever found |
|---|---|---|---|---|
| Keyword: whole-word match on title and description | 162 | 45 | 13 | 5 |
| Embedding: `voyage-4-lite`, top 25 by cosine, floor 0.45 | 114 | 61 | 16 | 21 |
| Both | 77 | 40 | 10 | |
| Either | 199 | 66 | 19 | |

The floor came from the sweep in the report. Unverified candidates inside the top 25 have a 90th-percentile similarity of 0.42, and 0.45 is the first step above it. At that floor the embedding retriever sends fewer candidates than keyword search and the verifier passes more of them. Where the difference comes from:

| Story | Keyword candidates, verified | Embedding candidates, verified | Only keyword | Only embedding |
|---|---|---|---|---|
| Gloria Steinem dies at 92 | 14, 8 | 17, 12 | 0 | 4 |
| Nvidia acquires Hugging Face | 41, 5 | 25, 5 | 0 | 0 |
| Energy crisis drives battery and power demand | 0, 0 | 5, 5 | 0 | 5 |
| Global bond market turmoil | 2, 2 | 5, 4 | 0 | 2 |

The Steinem row is a genuine keyword miss. NPR's episode about her has six segments, four of which say "Steinem" and never "Gloria Steinem"; the keyword is the full name, and whole-word matching does not match half of it. Nvidia is the reassuring row: the story with the most proper nouns, and both retrievers verified the same five segments. The energy row is the other thing embeddings do. The story is battery shortages in Spain and Portugal; the five segments are a Big Take episode about trading your own home electricity in the US, scored 8 and 9. Same beat, different event. Keyword search never sent those because they share no entity with the story, and the verifier, reading a title and one sentence, did not tell the two apart.

These numbers are verifier-graded. The 26 disagreements are in a spot-check list waiting for hand labels, and nothing above should be read as precision until they come back. Re-scoring also moved the pipeline's own matches: 38 of the 45 passed again, and 5 of the 7 that did not were the score-7 false positives named below.

**Showing the verifier the story.** The verifier that shipped sees the story's title and category. `compare --verifier context` re-scored the same candidates in the same chunks with a prompt that also shows the summary, keywords and headlines, and says that the same beat is not the same event ([`prompts/verify-match-context.md`](prompts/verify-match-context.md)). Full output, with every verdict that changed, is [`samples/retrieval-comparison-context.md`](samples/retrieval-comparison-context.md).

| Verifier, cutoff | Keyword verified | Embedding verified | Only keyword | Only embedding |
|---|---|---|---|---|
| Production, 7 | 45 | 61 | 5 | 21 |
| Context, 7 | 39 | 49 | 3 | 13 |
| Context, 8 | 30 | 38 | 0 | 8 |

It dropped 35 verdicts and added 6. Four of the five home-electricity segments went under 7, and so did a July jobs report that had been scored against August's, a gas-price segment scored against the diesel story, and the four Big Take segments on Nepal's hydropower after the floods, which are aftermath rather than the event. What it did not drop is the more useful result. Acer's laptop against the Lenovo story, the Hugging Face hack against the airport breach, and the Vergecast's Apple Home segments all still pass, every one of them at exactly 7, down from 8 and 9. The real embedding-only finds all sit at 8 or 9. Shown the story, the verifier puts same-beat matches on the threshold and same-event matches above it, which is the separation the threshold needed and did not have. At a cutoff of 8 the embedding retriever's exclusive finds are eight segments: three from NPR's Steinem episode, two on the bond selloff, one each on the jobs report and diesel prices, and The Daily on AI kill switches, which is the one I would still argue with. Nothing keyword search found alone survives a cutoff of 8.

The stricter prompt also loses two matches I would keep: the Tech Brew segment on Hugging Face's robot as the reason for Nvidia's price, which is analysis of the deal rather than the deal, and one Steinem segment about a first meeting in 1993. Both are fair calls either way, and both are the kind of thing the spot check exists for.

## Where it breaks

Everything below was observed on the sample run, and the sample was left as it came out.

### Clustering

- **Two stories for one event.** "Nepal Tunnel Rescues Bring Hope After Floods" and "Nepal Tunnel Rescue and Flood Recovery Efforts" are the same story from different batches. Their keyword sets are `Nepal, floods, tunnel rescues, China, survivors` and `Nepal, tunnel collapse, flash floods, rescue`. Exact-match overlap is one word, the merge rule needs two, so they never merged, and the same five segments were matched to both. Stemming would have caught it; so would showing the clusterer the existing story list, at the cost of a longer prompt.
- **One story for two events.** The merge rule fails the other way too. "Volkswagen Cuts 50,000 Jobs" carries the keywords `Uber, robotaxis, UK` because a cluster about Uber and driver unions shared `job cuts` and `UK` with it, and "Trump's Peace Envoys Visit Moscow and Kyiv" absorbed a Russian drone attack on Kyiv. Two shared keywords is too low a bar when the keywords are that generic.
- **Umbrella stories.** The prompt asks for at most ten stories per call and at least two headlines each, so the tail of every batch gets forced into groups like "Smart Home and Tech Gadgets Advance", "Music Festivals and Entertainment Highlights", and "Paleontology Discoveries: Antarctica and Stonehenge". They are harmless here because nothing matches them, but they are not stories. The at-least-two rule is also not enforced in code: the Steinem story has one headline.
- **Keywords that cannot retrieve anything.** `$12.9 billion`, `50000 jobs`, `August`, `Nikkei Asia`. The prompt asks for proper nouns and events; the model pads the list anyway.
- **Temperature 0 is not reproducibility.** Two runs nine minutes apart over the same 270 headlines produced 36 and 37 stories with different titles and keyword sets, and therefore different candidates and matches for the same event ("Stock Market Reacts to Jobs Report" with five matches became "Strong US Jobs Report Fuels Rate Rise Expectations" with four). Batch composition decides what the clusterer sees, and nothing pins it.

### Retrieval

- **The headline feeds do not cover the podcasts' beat.** This week's shows spent more segments on the arrest of an ICE agent (7 shows), New York's school AI ban (5), the Venezuela oil deal (5), the Iran strikes (5), and Meta's settlement (4) than on anything that became a story. None of those became stories, because BBC sections plus Google News top stories plus a ten-item NPR feed underrepresent US domestic and business news at the moment of the run. The story side is only as good as its headline sources, and these were chosen for being free and stable, not for matching the catalog. Adding US-domestic feeds is the obvious fix; so is the production habit of clustering every 30 minutes so stories accumulate across a day.
- **Two production bugs, found here.** Keyword search was a substring match (`LIKE '%AI%'` in production). The keyword `AI` therefore matched 124 of 267 segments through "said", "raise", and "Haiti", and every story that inherited `AI` through a merge sent 126 candidates to the verifier. With that many candidates the verifier began returning list positions in the `convoIdx` field, and since the code matched results back by `(episodeId, convoIdx)`, all of them were dropped: the Nvidia story verified 0 of 126. Whole-word matching and index-addressed results fixed both, and the sample was produced after the fix. The "Discover sparsity" that production tuned around by lowering the activation threshold was, I now think, partly this.
- **Embeddings surface the same beat as readily as the same event.** As shipped, recall depended on a story's keywords appearing verbatim in a segment's title or one-sentence description, and the comparison below put a number on that: 21 verified segments the embedding retriever found and keyword search did not, against 5 the other way. The clean case is a surname, since "Steinem" does not match the keyword "Gloria Steinem". About half of the 21 were the same beat rather than the same event, Acer's laptop for a Lenovo story and the like. Keyword search's entity requirement used to keep those out for free; with union retrieval they reach the verifier, and refusing them is now the verifier's job plus the cutoff's. Two graded mechanisms replaced one structural one, and the spot check that grades them has not come back.

### Verification

- **Eight costs borderline matches.** As shipped, at a cutoff of 7 with the title-only verifier, 6 of 45 matches were wrong and every one of them scored exactly 7: "India's Avocado Market Booms" matched three unrelated agriculture segments, "UK Drought Crisis" matched a Georgia timber farmer switching to blueberries, "El Niño" matched UK energy traders, and the mis-merged Volkswagen story matched Uber's layoffs. Every score of 8 or above was correct. The current defaults drop all six. They also drop eleven others, and some of those I would keep: Tech Brew on Hugging Face's robot as the reason for Nvidia's price, scored 9 before and under 8 now; Odd Lots on Bessent's Treasury buybacks; Big Take's segments on Nepal's hydropower after the floods. Against the 45 as shipped, 28 survived, 17 dropped and 7 were added, and reading the 35 that remain I find nothing I would mark wrong. That is my reading, not a label.
- **It cannot tell the same beat from the same event without being shown the story.** Keyword candidates share an entity with the story by construction, so a verifier shown only the title only had to reject the wrong story about the right company, which it did. Embedding candidates need not share anything, and shown only the title the verifier passed Acer's lightweight laptop against a Lenovo laptop story at 9, a US home-electricity episode against Spanish battery shortages at 9, and The Daily's Hugging Face hack against an airport data breach at 9. Shown the summary, keywords and headlines, it scores all of those at exactly 7 and the real matches at 8 and 9, which is why the cutoff moved to 8. The separation is one point wide.
- **It cannot see depth.** The verifier reads a title and one sentence per candidate, so an episode's cold open ("Meet Darrell Duffie", "Two Icons, One Week") scores as high as the ten-minute discussion that follows. Ranking by score does not rank by how much of the story a listener will hear.

### Segmentation

- **The count guideline is advisory.** The prompt suggests 3–5 segments for a 10–30 minute episode; 28 of 39 episodes came back above their band. For news roundups that is probably right (a 13-minute Up First has four stories plus intros) and the guideline is wrong, but nothing measures it either way.
- **Intros and ad reads.** 15 of 39 episodes open with a segment that is an intro or headline preview. On single-host shows an ad read in the middle of a topic is absorbed into that topic's segment; one anchor phrase in the sample begins "with at&t connected car, your eligible vehicle".
- **Monologues broke it until this run.** Diarization returned one utterance for a 19-minute single-host episode, so the transcript the model saw had one timestamp; six of its seven boundaries were guesses with no anchor phrase. Splitting utterances longer than 45 seconds at sentence ends fixed it, and because that changes the prompt for 38 of 39 episodes, everything was re-segmented. It is the only segmentation change from production.
- **Snapping is approximate.** Starts snap to the nearest boundary within 30 seconds, which guarantees a sentence start but not the topic start; a few anchor phrases begin with the last words of the previous topic.

### Everything

- **No tests, no eval set.** Quality was judged by reading output, which is how every threshold above was chosen. The retrieval comparison is the first measurement in the repository, and the defaults were changed on its evidence, but it is graded by the same verifier, so it measures the two retrievers against each other rather than against truth; its 26 disagreements sit in a spot-check list waiting for hand labels. The first thing this still needs is a hundred labelled (story, segment) pairs, so that the 7-versus-8 question becomes a number instead of a paragraph.
- **Cost tracking is list-price arithmetic on token counts.** Transcription cost is not computed; `run.json` records audio hours for pricing against whatever the current rate is.
- **Nothing scales.** Candidates are an in-memory scan and stories are one JSON file. Production had a database for that and a Worker CPU limit to fight; this repository has neither, by design.

## Run it yourself

Requirements: Node 22.18 or newer (the code is TypeScript run directly by Node, no build step), an [AssemblyAI](https://www.assemblyai.com) key, an [Anthropic](https://console.anthropic.com) key, and a [Voyage AI](https://www.voyageai.com) key. Voyage's free tier covers the embeddings many times over; it is only optional if you run with `--retriever keyword`.

```bash
git clone https://github.com/david-wills/convos-pipeline
cd convos-pipeline
npm install
cp .env.example .env      # add all three keys
node src/cli.ts run       # ingest → transcribe → segment → stories → match → report
```

`feeds.json` is the configuration the sample was produced with: 20 podcast feeds, 9 news feeds, and the selection rule (newest 2 episodes per feed from the last 3 days, under 45 minutes). Change the feeds or the rule there. Expect roughly 13–15 hours of audio to transcribe with those settings, so try `"maxPerFeed": 1` and a few feeds first.

Each step is its own command and is safe to re-run:

```bash
node src/cli.ts ingest        # free: fetch feeds, pick episodes  -> data/episodes.json
node src/cli.ts transcribe    # AssemblyAI                         -> data/transcripts/
node src/cli.ts segment       # Claude Sonnet                      -> data/convos/
node src/cli.ts stories       # news feeds + Claude Haiku          -> data/stories.json
node src/cli.ts match         # keywords + embeddings, Claude Haiku -> data/matches.json
node src/cli.ts report        # write samples/ and viz/data.js
```

`--force` redoes a step that already has output. `--concurrency N` sets parallel Claude calls (default 4). Models can be overridden with `CONVOS_SEGMENT_MODEL` and `CONVOS_CLASSIFY_MODEL`. `npm run typecheck` runs `tsc` if you want types checked; nothing depends on it.

Retrieval and verification are configured in `feeds.json` under `matching` (`retriever`, `verifier`, `minScore`, and `embedding.topK` and `embedding.minSimilarity`), and `--retriever` and `--verifier` override them per run:

```bash
node src/cli.ts match --retriever keyword --verifier production --force   # the pipeline as it shipped; set minScore to 7 for the full effect
node src/cli.ts compare --verifier production   # keyword vs embeddings, scored by the shipped verifier -> samples/retrieval-comparison.md
node src/cli.ts compare                         # same candidates, scored by the verifier shown the story -> retrieval-comparison-context.md
```

Vectors are cached under `data/embeddings/` by content hash, so a second `compare` re-verifies but does not re-embed, and `report` re-renders both comparisons from `data/comparison*.json` without any API call. `CONVOS_EMBED_MODEL` overrides the embedding model (default `voyage-4-lite`).

## What this was extracted from

Convos is a SwiftUI iOS app with a Cloudflare Worker backend (D1, R2, Queues, cron triggers). This repository is the Worker's pipeline code with the platform bindings replaced by JSON files on disk and the three prompts copied verbatim. Not included: the app, the HTTP API, charts, guest extraction, scheduling, and the admin dashboard. The post-processing, merge rule and scoring logic are unchanged. Matching is not: retrieval, the verifier prompt and the cutoff all differ from production for the reasons measured above, and the shipped configuration is one flag away.

The pipeline is the part of the product that was hard. If the app ships later, this will already be done.

## License

MIT.
