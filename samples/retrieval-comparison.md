# Retrieval comparison: keyword search against embeddings

Written by `node src/cli.ts compare` on 2026-09-06. Same 37 stories, same 267 segments, same verifier prompt and model for every candidate. Nothing here was edited by hand.

## How the two retrievers were compared

- **Keyword.** Any story keyword, matched as a whole word, in a segment's title or description. Capped at 200 candidates per story, newest episode first. This is the pipeline's retriever.
- **Embedding.** Cosine similarity between the story text and each segment text with `voyage-4-lite` at 1024 dimensions. Story text is the title, summary and keywords; segment text is the title and description. The top 25 segments per story, then a similarity floor of 0.45.
- **Same input.** Neither retriever sees transcript text. Both read the same segment title and one-sentence description.
- **Verified once.** For each story the union of both candidate lists was scored by `claude-haiku-4-5-20251001` at temperature 0 with `prompts/verify-match.md`, in calls of at most 50 candidates. A candidate both retrievers found therefore has one score. Verified means 7 or more.
- **No floor at verification time.** The whole top 25 was verified, so the floor is a filter over already-scored candidates and can be varied below without another model call.

| | |
|---|---|
| Verifier calls | 37 |
| Verifier tokens | 75271 in, 4067 out |
| Embedding tokens | 11486 |
| Cost of this comparison at list price | $0.10 |

## Totals

| Retriever | Candidates | Verified | Verified per candidate | Stories with coverage | Shows | Verified that only this retriever found |
|---|---|---|---|---|---|---|
| Keyword | 162 | 45 | 28% | 13 | 14 | 5 |
| Embedding, top 25, floor 0.45 | 114 | 61 | 54% | 16 | 16 | 21 |
| Either | 199 | 66 | 33% | 19 | 16 |  |
| Both | 77 | 40 | 52% | 10 | 14 |  |

29 verified segments sat inside the embedding top 25 but under the floor, so neither retriever is credited above.

## Story by story

| Story | Keyword candidates | Embedding candidates | In both | Keyword verified | Embedding verified | Only keyword | Only embedding |
|---|---|---|---|---|---|---|---|
| Gloria Steinem, Feminist Icon, Dies at 92 | 14 | 17 | 12 | 8 | 12 | 0 | 4 |
| Nepal Tunnel Rescues Bring Hope After Floods | 12 | 7 | 7 | 8 | 7 | 1 | 0 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | 8 | 7 | 7 | 8 | 7 | 1 | 0 |
| Nvidia Acquires Hugging Face for $12.9 Billion | 41 | 25 | 20 | 5 | 5 | 0 | 0 |
| Strong US Jobs Report Fuels Rate Rise Expectations | 5 | 7 | 5 | 4 | 5 | 0 | 1 |
| Energy Crisis Drives Battery and Power Demand | 0 | 5 | 0 | 0 | 5 | 0 | 5 |
| US Diesel Prices Hit Record Highs | 4 | 5 | 2 | 2 | 4 | 0 | 2 |
| Global Bond Market Turmoil Concerns World Leaders | 2 | 5 | 2 | 2 | 4 | 0 | 2 |
| Lindsay Clancy Murder Trial Heads Toward Mistrial | 3 | 3 | 3 | 3 | 3 | 0 | 0 |
| Major Cybersecurity Breaches Hit Airports and Platforms | 0 | 2 | 0 | 0 | 2 | 0 | 2 |
| Smart Home and Tech Gadgets Advance | 0 | 2 | 0 | 0 | 2 | 0 | 2 |
| Trump's Peace Envoys Visit Moscow and Kyiv | 23 | 0 | 0 | 1 | 0 | 1 | 0 |
| Foldable iPhone Production Ramping Up Slowly | 11 | 3 | 3 | 1 | 1 | 0 | 0 |
| Volkswagen Cuts 50,000 Jobs in Major Restructuring | 8 | 3 | 3 | 1 | 1 | 0 | 0 |
| Chrome V8 Zero-Day Vulnerability Patched | 7 | 1 | 1 | 1 | 0 | 1 | 0 |
| UK Drought Crisis Impacts Agriculture and Water Supply | 3 | 1 | 1 | 1 | 0 | 1 | 0 |
| El Niño Weather Impacts Intensify Globally | 2 | 2 | 1 | 0 | 1 | 0 | 1 |
| AI Regulation and Tech Safety Concerns in UK | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| Lenovo Launches Lightweight Laptop Alternatives | 0 | 1 | 0 | 0 | 1 | 0 | 1 |
| NVIDIA DLSS 5 Expands GPU Support | 8 | 11 | 8 | 0 | 0 | 0 | 0 |
| India's Avocado Market Booms Despite Skepticism | 6 | 2 | 2 | 0 | 0 | 0 | 0 |
| Steve Irwin Remembered 20 Years After Death | 2 | 1 | 0 | 0 | 0 | 0 | 0 |
| Fly Brain Research Advances Neuroscience Understanding | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Harry Potter HBO Series Casts Chamber of Secrets Season 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Russia Suspected in European Sabotage Campaign | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Alcohol-Related Cancer Deaths Double in Recent Years | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| All-Female Spacewalk and NASA Moon Mission | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Ariana Grande and Kasabian Step Back from Public Life | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Dark Matter and Higgs Boson: Major Physics Breakthroughs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Final Fantasy VII Revelation DLC Plans Announced | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Grand Theft Auto Marketing Deal Faces Legal Challenge | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Music Festivals and Entertainment Highlights | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Paleontology Discoveries: Antarctica and Stonehenge | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Philippine VP Ordered Arrested Over Presidential Threats | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pig Kidney Transplant Achieves Record Survival | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| UK Workplace Violations: Wage and Safety Issues | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Upcoming Gaming Releases: January 2027 Launches | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Where they disagree

Every verified segment that only one retriever surfaced. For keyword-only rows the cosine and rank say how far the embedding retriever was from finding it. Embedding-only rows contain none of the story's keywords by construction.

| Story | Found by | Show | Segment | Time | Score | Cosine | Rank of 267 |
|---|---|---|---|---|---|---|---|
| Lenovo Launches Lightweight Laptop Alternatives | embedding | Tech Brew Ride Home | **Acer's MacBook Air Challenger** Acer announces the Swift Blade 14, a carbon-fiber laptop weighing just 1.76 pounds that undercuts the MacBook Air's weight while matching its thinness, launching in December. | 16:25 to 18:50 | 9 | 0.582 | 1 |
| Major Cybersecurity Breaches Hit Airports and Platforms | embedding | The Daily | **The Hugging Face Cyberattack** 700 agents coordinate to hack Hugging Face, stealing credentials and seizing administrator-level control of real servers before finally getting caught. | 14:42 to 21:16 | 9 | 0.519 | 1 |
| Global Bond Market Turmoil Concerns World Leaders | embedding | Odd Lots | **Why Is the 30-Year at 5%?** Duffie explains that soaring yields are driven by sheer supply — $31 trillion and rising — overwhelming discretionary investors who need higher compensation to absorb more debt. | 05:42 to 08:40 | 9 | 0.512 | 2 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **Vibe Coding the Power Grid** Three forces — cheaper solar panels, dynamic utility pricing, and AI coding tools like ChatGPT — have made home energy trading newly accessible to non-experts. | 07:57 to 09:58 | 9 | 0.507 | 1 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **Virtual Power Plants Pay Off** Not everyone trades aggressively — retired Arizona homeowner Greg Robinson lets his utility tap his battery during demand spikes, earning $1,000 in seven months with almost no effort. | 09:58 to 11:22 | 9 | 0.490 | 3 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **Steinem's Vision for Every Movement** Disney reflects on how Steinem wanted to be remembered — not as a hero, but as someone who helped everyone recognize their own power. | 08:42 to 11:06 | 8 | 0.605 | 6 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **The Burden of Being the Face** Disney reveals how Steinem quietly resisted being crowned feminism's sole symbol and faced criticism from within the movement itself. | 07:06 to 08:42 | 8 | 0.589 | 9 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **Meeting the 'Cultural Villain'** Disney describes growing up in a household hostile to feminism and her surprising first encounter with Steinem in 1993. | 04:08 to 05:25 | 8 | 0.581 | 10 |
| Gloria Steinem, Feminist Icon, Dies at 92 | embedding | Consider This from NPR | **Steinem's Radical Generosity** Disney recalls how Steinem visited her in the hospital weekly and became the mentor her own mother never was. | 05:25 to 07:06 | 8 | 0.573 | 11 |
| US Diesel Prices Hit Record Highs | embedding | Today, Explained | **The Cost Crunch Squeezing Agriculture** Guardian reporter Chris Stein breaks down how rising diesel, fertilizer prices, and lost soybean markets in China are hammering farm country across the US. | 02:04 to 05:15 | 8 | 0.548 | 4 |
| Strong US Jobs Report Fuels Rate Rise Expectations | embedding | Bloomberg Daybreak: US Edition | **September Hike: Coin Flip or Done Deal?** Sahm walks through why today's report tilts toward officials favoring a hike but stops short of calling it decisive, with inflation data remaining the true swing factor. | 06:19 to 08:33 | 8 | 0.540 | 6 |
| Global Bond Market Turmoil Concerns World Leaders | embedding | Bloomberg Daybreak: US Edition | **Kristina Campmany: Shorter Duration, Full Stop** Invesco's senior portfolio manager argues for staying short duration globally, warning that a flood of long-end supply and unaddressed fiscal concerns spell indigestion ahead for bond markets. | 19:02 to 23:33 | 8 | 0.518 | 1 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **The Barrier Blocking Most Consumers** Widespread home energy trading won't happen until utilities and regulators unlock dynamic pricing — a small regulatory shift with potentially enormous behavioral impact. | 19:03 to 22:14 | 8 | 0.500 | 2 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **Why Electricity Is Different** Akshat explains how the regulated monopoly structure of energy grids is being forced to evolve as consumers become producers and startups step in as middlemen. | 15:00 to 17:35 | 8 | 0.488 | 4 |
| Energy Crisis Drives Battery and Power Demand | embedding | Big Take | **Meta Enters the Power Market** Big Tech's massive AI energy appetite is turning companies like Meta into serious electricity traders, with hedge funds and oil firms following close behind. | 17:35 to 19:03 | 8 | 0.482 | 5 |
| Major Cybersecurity Breaches Hit Airports and Platforms | embedding | The Daily | **The Hack Beneath the Hack** Kevin reveals that the Hugging Face breach was just the visible tip of a much larger, stranger operation unfolding inside OpenAI for three months. | 02:03 to 04:43 | 8 | 0.474 | 2 |
| Smart Home and Tech Gadgets Advance | embedding | The Vergecast | **The Pixar Lamp Is Real?** Andrew makes the case that Apple's rumored robotic tabletop display — codenamed Charismatic — is more likely than Jen thinks, and could use existing DotKit tracking tech to follow you around the room. | 33:39 to 39:31 | 8 | 0.460 | 1 |
| Smart Home and Tech Gadgets Advance | embedding | The Vergecast | **Apple Home's Missing Piece** Jen and Andrew set the stage by explaining what Apple Home is and why it's been lacking a smart display for years. | 00:02 to 08:25 | 8 | 0.450 | 2 |
| US Diesel Prices Hit Record Highs | embedding | CNN 5 Things | **Record Gas Prices This Labor Day** CNN's Matt Egan explains why Americans are paying above $4 a gallon and why the Trump administration's fixes aren't working. | 01:00 to 02:01 | 7 | 0.618 | 2 |
| AI Regulation and Tech Safety Concerns in UK | embedding | The Daily | **Regulators, Kill Switches, and Slowdowns** Kevin explains how this real-world incident has shattered AI skepticism among policymakers and sparked an industry-wide call to pump the brakes. | 30:45 to 34:32 | 7 | 0.596 | 1 |
| El Niño Weather Impacts Intensify Globally | embedding | Big Take | **A Global Crisis, Not Just Nepal** From Alaska to Switzerland to the Indian Himalayas, glacial lake outburst floods are threatening communities on four continents. | 07:53 to 09:13 | 7 | 0.464 | 2 |
| Nepal Tunnel Rescue and Flood Recovery Efforts | keyword | Big Take | **Why Mountains Are Falling Apart** Melting glaciers and thawing permafrost are destabilizing mountain landscapes globally, making deadly landslides and flash floods an increasingly common occurrence. | 05:21 to 07:53 | 8 | 0.425 | 8 |
| Nepal Tunnel Rescues Bring Hope After Floods | keyword | Big Take | **Why Mountains Are Falling Apart** Melting glaciers and thawing permafrost are destabilizing mountain landscapes globally, making deadly landslides and flash floods an increasingly common occurrence. | 05:21 to 07:53 | 8 | 0.419 | 8 |
| UK Drought Crisis Impacts Agriculture and Water Supply | keyword | FT News Briefing | **Agriculture, Tariffs, and 'Iconic' UK Goods** Greer flags the US-UK agricultural trade deficit and expresses skepticism about some of Britain's requests for better market access. | 03:32 to 05:50 | 7 | 0.440 | 2 |
| Chrome V8 Zero-Day Vulnerability Patched | keyword | Tech Brew Ride Home | **Today's Tech Headlines** Brian previews the day's biggest stories: new Claude models, Google's AI counter-move, OpenAI's Astra tease, a Google antitrust ruling, and a massive ID data leak. | 00:04 to 01:50 | 7 | 0.429 | 2 |
| Trump's Peace Envoys Visit Moscow and Kyiv | keyword | Bloomberg Daybreak: US Edition | **Trump's China Trade Optimism** US Trade Representative Jameson Greer strikes an upbeat tone ahead of the Trump-Xi summit, citing a shrinking trade deficit and possible tariff exclusions. | 05:14 to 05:56 | 7 | 0.340 | 10 |

## Choosing the floor

Cosine similarity of verified against unverified candidates inside the top 25:

| | Count | Min | p10 | Median | p90 | Max |
|---|---|---|---|---|---|---|
| Verified, score 7 or more | 95 | 0.272 | 0.362 | 0.518 | 0.697 | 0.784 |
| Not verified | 830 | 0.245 | 0.280 | 0.345 | 0.421 | 0.669 |

The embedding retriever at each floor. "Lost" counts verified segments inside the top 25 that the floor removes.

| Floor | Candidates | Verified | Only embedding | Lost |
|---|---|---|---|---|
| none | 925 | 95 | 50 | 0 |
| 0.20 | 925 | 95 | 50 | 0 |
| 0.25 | 920 | 95 | 50 | 0 |
| 0.30 | 761 | 92 | 47 | 3 |
| 0.35 | 459 | 89 | 45 | 5 |
| 0.40 | 205 | 79 | 35 | 15 |
| 0.45 | 114 | 61 | 21 | 29 |
| 0.50 | 73 | 53 | 14 | 36 |
| 0.55 | 42 | 39 | 7 | 43 |
| 0.60 | 29 | 26 | 2 | 48 |
| 0.65 | 19 | 17 | 0 | 50 |
| 0.70 | 8 | 8 | 0 | 50 |
| 0.75 | 3 | 3 | 0 | 50 |
| 0.80 | 0 | 0 | 0 | 50 |

The configured floor is 0.45, set in `feeds.json` under `matching.embedding.minSimilarity`.

## Choosing the threshold

The pipeline keeps scores of 7 and above. Same candidates and same scores at a stricter cutoff:

| Threshold | Keyword verified | Embedding verified | Only keyword | Only embedding | Either | Both |
|---|---|---|---|---|---|---|
| 7 | 45 | 61 | 5 | 21 | 66 | 40 |
| 8 | 37 | 53 | 2 | 18 | 55 | 35 |
| 9 | 24 | 29 | 0 | 5 | 29 | 24 |

## Agreement with the pipeline run

`data/matches.json` holds 45 matches from the keyword pipeline. 45 of them were re-scored here, 38 scored 7 or more again and 7 did not. 7 keyword candidates verified here that had not in the pipeline run. The verifier runs at temperature 0, but a candidate's score moves with the other candidates in its call, so some drift is expected.

| Story | Show | Segment | Pipeline score | Score here |
|---|---|---|---|---|
| Strong US Jobs Report Fuels Rate Rise Expectations | Bloomberg Daybreak: US Edition | August Jobs Report Preview | 7 | under 7 |
| Nvidia Acquires Hugging Face for $12.9 Billion | Tech Brew Ride Home | The $399 Duck Changes Everything | 9 | under 7 |
| India's Avocado Market Booms Despite Skepticism | FT News Briefing | Agriculture, Tariffs, and 'Iconic' UK Goods | 7 | under 7 |
| India's Avocado Market Booms Despite Skepticism | The Journal. | Blueberries Over Pine Trees | 7 | under 7 |
| India's Avocado Market Booms Despite Skepticism | Today, Explained | The Cost Crunch Squeezing Agriculture | 7 | under 7 |
| El Niño Weather Impacts Intensify Globally | Big Take | Heat Waves Are Payday | 7 | under 7 |
| UK Drought Crisis Impacts Agriculture and Water Supply | The Journal. | Blueberries Over Pine Trees | 7 | under 7 |

## Caveats

- Every number above is graded by the verifier, not by a person. `data/spot-check.md` lists the disagreements for manual labelling; until that comes back, "verified" means the verifier said 7 or more.
- Both retrievers read only the segment title and description. Embedding transcript text would be a different experiment with a different cost.
- Candidates were verified in chunks, so a score can depend on its chunk-mates. Both retrievers share the chunks, so the comparison stays fair where absolute scores drift.
- Story clustering is not reproducible at temperature 0. This comparison used the committed `data/stories.json` and did not re-cluster.
